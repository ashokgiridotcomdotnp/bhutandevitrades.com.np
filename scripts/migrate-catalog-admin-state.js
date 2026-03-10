#!/usr/bin/env node

require('dotenv').config({ quiet: true });

var fs = require('fs');
var path = require('path');
var database = require('../lib/db');
var AdminState = require('../models/AdminState');
var Category = require('../models/Category');
var Brand = require('../models/Brand');
var Product = require('../models/Product');

var ADMIN_STATE_KEYS = ['catalog-admin-state', 'catalog-admin-data'];
var ADMIN_DATA_FILE_PATH = path.join(__dirname, '..', 'data', 'admin-data.json');

function toTrimmedString(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }

  return String(value).trim();
}

function normalizeName(value) {
  return toTrimmedString(value).toLowerCase().replace(/\s+/g, ' ');
}

function slugify(value) {
  return toTrimmedString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parsePrice(value) {
  var cleanedValue = toTrimmedString(value).replace(/,/g, '');
  var matchedValue = cleanedValue.match(/-?\d+(?:\.\d+)?/);
  var parsedValue = matchedValue ? Number(matchedValue[0]) : NaN;

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return 0;
  }

  return Math.round(parsedValue * 100) / 100;
}

function parseQuantity(value) {
  var cleanedValue = toTrimmedString(value).replace(/,/g, '');
  var matchedValue = cleanedValue.match(/-?\d+(?:\.\d+)?/);
  var parsedValue = matchedValue ? Number(matchedValue[0]) : NaN;

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return 0;
  }

  return Math.floor(parsedValue);
}

function resolveAdminStateValue(stateDoc) {
  if (!stateDoc || typeof stateDoc !== 'object') {
    return null;
  }

  if (stateDoc.value && typeof stateDoc.value === 'object') {
    return stateDoc.value;
  }

  if (stateDoc.payload && typeof stateDoc.payload === 'object') {
    return stateDoc.payload;
  }

  if (
    Array.isArray(stateDoc.categories) ||
    Array.isArray(stateDoc.products) ||
    (stateDoc.priceOverrides && typeof stateDoc.priceOverrides === 'object') ||
    (stateDoc.imageOverrides && typeof stateDoc.imageOverrides === 'object') ||
    (stateDoc.productOverrides && typeof stateDoc.productOverrides === 'object')
  ) {
    return {
      categories: stateDoc.categories || [],
      products: stateDoc.products || [],
      priceOverrides: stateDoc.priceOverrides || {},
      imageOverrides: stateDoc.imageOverrides || {},
      productOverrides: stateDoc.productOverrides || {},
      deletedProductIds: stateDoc.deletedProductIds || [],
      deletedCategoryNames: stateDoc.deletedCategoryNames || [],
    };
  }

  return null;
}

async function loadLegacyAdminState() {
  var stateDoc = await AdminState.findOne({}).where('key').in(ADMIN_STATE_KEYS).sort({ updatedAt: -1 }).lean();

  if (stateDoc) {
    return resolveAdminStateValue(stateDoc);
  }

  try {
    var fileContent = fs.readFileSync(ADMIN_DATA_FILE_PATH, 'utf8');
    var parsedFile = JSON.parse(fileContent);
    return resolveAdminStateValue(parsedFile);
  } catch (error) {
    return null;
  }
}

function normalizeLegacyData(rawData) {
  var safeData = {
    categories: [],
    products: [],
    priceOverrides: {},
    imageOverrides: {},
    productOverrides: {},
    deletedProductIds: [],
    deletedCategoryNames: [],
  };

  if (!rawData || typeof rawData !== 'object') {
    return safeData;
  }

  if (Array.isArray(rawData.categories)) {
    safeData.categories = rawData.categories
      .map(function (entry) {
        var name = toTrimmedString(entry && entry.name);
        return {
          name: name,
          description: toTrimmedString(entry && entry.description),
          items: Array.isArray(entry && entry.items)
            ? entry.items.map(function (item) { return toTrimmedString(item); }).filter(Boolean)
            : [],
        };
      })
      .filter(function (entry) {
        return entry.name;
      });
  }

  if (Array.isArray(rawData.products)) {
    safeData.products = rawData.products
      .map(function (entry) {
        return {
          id: toTrimmedString(entry && entry.id),
          type: toTrimmedString(entry && entry.type),
          name: toTrimmedString(entry && entry.name),
          spec: toTrimmedString(entry && entry.spec),
          description: toTrimmedString(entry && entry.description),
          price: toTrimmedString(entry && entry.price),
          quantity: toTrimmedString(entry && entry.quantity),
          image: toTrimmedString(entry && entry.image),
        };
      })
      .filter(function (entry) {
        return entry.id || (entry.type && entry.name);
      });
  }

  if (rawData.priceOverrides && typeof rawData.priceOverrides === 'object') {
    safeData.priceOverrides = rawData.priceOverrides;
  }

  if (rawData.imageOverrides && typeof rawData.imageOverrides === 'object') {
    safeData.imageOverrides = rawData.imageOverrides;
  }

  if (rawData.productOverrides && typeof rawData.productOverrides === 'object') {
    safeData.productOverrides = rawData.productOverrides;
  }

  if (Array.isArray(rawData.deletedProductIds)) {
    safeData.deletedProductIds = rawData.deletedProductIds.map(toTrimmedString).filter(Boolean);
  }

  if (Array.isArray(rawData.deletedCategoryNames)) {
    safeData.deletedCategoryNames = rawData.deletedCategoryNames.map(toTrimmedString).filter(Boolean);
  }

  return safeData;
}

function buildCategoryItemsMap(categories) {
  var map = Object.create(null);

  (categories || []).forEach(function (category) {
    var categoryKey = normalizeName(category && category.name);

    if (!categoryKey) {
      return;
    }

    if (!Array.isArray(map[categoryKey])) {
      map[categoryKey] = [];
    }

    (category.items || []).forEach(function (item) {
      var cleanItem = toTrimmedString(item);
      if (!cleanItem) {
        return;
      }

      if (map[categoryKey].indexOf(cleanItem) === -1) {
        map[categoryKey].push(cleanItem);
      }
    });
  });

  return map;
}

function inferBrandName(productName, categoryName, categoryItemsMap) {
  var normalizedCategory = normalizeName(categoryName);
  var categoryItems = categoryItemsMap[normalizedCategory] || [];
  var productNameNormalized = normalizeName(productName);
  var firstToken = toTrimmedString(productName).split(/\s+/)[0];

  if (productNameNormalized) {
    var matchedItem = categoryItems.find(function (item) {
      return normalizeName(item) === productNameNormalized;
    });

    if (matchedItem) {
      return matchedItem;
    }
  }

  if (categoryItems.length === 1) {
    return categoryItems[0];
  }

  if (firstToken) {
    return firstToken;
  }

  return 'Generic';
}

function buildEffectiveProducts(legacyData) {
  var deletedProductSet = Object.create(null);
  var deletedCategorySet = Object.create(null);
  var categoryItemsMap = buildCategoryItemsMap(legacyData.categories);
  var productsByLegacyId = Object.create(null);
  var results = [];

  legacyData.deletedProductIds.forEach(function (id) {
    deletedProductSet[normalizeName(id)] = true;
  });

  legacyData.deletedCategoryNames.forEach(function (name) {
    deletedCategorySet[normalizeName(name)] = true;
  });

  function pushProduct(rawProduct, productIdFromSource, overrideEntry) {
    var legacyId = toTrimmedString(productIdFromSource || (rawProduct && rawProduct.id));
    var productKey = normalizeName(legacyId);
    var categoryName = toTrimmedString((overrideEntry && overrideEntry.type) || (rawProduct && rawProduct.type));
    var productName = toTrimmedString((overrideEntry && overrideEntry.name) || (rawProduct && rawProduct.name));
    var categoryKey = normalizeName(categoryName);
    var brandName = toTrimmedString((overrideEntry && overrideEntry.brand) || (rawProduct && rawProduct.brand));
    var description = toTrimmedString((overrideEntry && overrideEntry.description) || (rawProduct && rawProduct.description));
    var spec = toTrimmedString((overrideEntry && overrideEntry.spec) || (rawProduct && rawProduct.spec));
    var priceSource = toTrimmedString(legacyData.priceOverrides[legacyId]) || toTrimmedString((overrideEntry && overrideEntry.price) || (rawProduct && rawProduct.price));
    var quantitySource = toTrimmedString((overrideEntry && overrideEntry.quantity) || (rawProduct && rawProduct.quantity));
    var imageUrl = toTrimmedString(legacyData.imageOverrides[legacyId]) || toTrimmedString((overrideEntry && overrideEntry.image) || (rawProduct && rawProduct.image));

    if (!legacyId) {
      legacyId = slugify([categoryName, productName].join('-')) || String(Date.now());
      productKey = normalizeName(legacyId);
    }

    if (!categoryName || !productName || deletedProductSet[productKey] || deletedCategorySet[categoryKey]) {
      return;
    }

    if (!brandName) {
      brandName = inferBrandName(productName, categoryName, categoryItemsMap);
    }

    if (!brandName) {
      brandName = 'Generic';
    }

    if (productsByLegacyId[productKey]) {
      return;
    }

    productsByLegacyId[productKey] = true;

    results.push({
      legacyId: legacyId,
      categoryName: categoryName,
      brandName: brandName,
      productName: productName,
      description: description,
      spec: spec,
      price: parsePrice(priceSource),
      quantity: parseQuantity(quantitySource),
      imageUrl: imageUrl,
    });
  }

  legacyData.products.forEach(function (rawProduct) {
    var legacyId = toTrimmedString(rawProduct && rawProduct.id);
    var overrideEntry = legacyId ? legacyData.productOverrides[legacyId] : null;
    pushProduct(rawProduct, legacyId, overrideEntry);
  });

  Object.keys(legacyData.productOverrides).forEach(function (legacyId) {
    if (productsByLegacyId[normalizeName(legacyId)]) {
      return;
    }

    pushProduct(
      {
        id: legacyId,
      },
      legacyId,
      legacyData.productOverrides[legacyId]
    );
  });

  return results;
}

function uniqueArray(values) {
  var seen = Object.create(null);

  return (values || []).filter(function (value) {
    var key = normalizeName(value);

    if (!key || seen[key]) {
      return false;
    }

    seen[key] = true;
    return true;
  });
}

async function upsertCategory(name, description, dryRun) {
  var normalizedName = normalizeName(name);

  if (!normalizedName) {
    return null;
  }

  if (dryRun) {
    return {
      _id: normalizedName,
      name: toTrimmedString(name),
    };
  }

  await Category.updateOne(
    { normalizedName: normalizedName },
    {
      $set: {
        name: toTrimmedString(name),
        normalizedName: normalizedName,
        slug: slugify(name),
        description: toTrimmedString(description),
        isActive: true,
      },
    },
    {
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );

  return Category.findOne({ normalizedName: normalizedName });
}

async function upsertBrand(categoryId, name, dryRun) {
  var normalizedName = normalizeName(name);

  if (!normalizedName) {
    return null;
  }

  if (dryRun) {
    return {
      _id: String(categoryId) + ':' + normalizedName,
      category: categoryId,
      name: toTrimmedString(name),
    };
  }

  await Brand.updateOne(
    {
      category: categoryId,
      normalizedName: normalizedName,
    },
    {
      $set: {
        category: categoryId,
        name: toTrimmedString(name),
        normalizedName: normalizedName,
        slug: slugify(name),
        isActive: true,
      },
    },
    {
      upsert: true,
      runValidators: true,
      setDefaultsOnInsert: true,
    }
  );

  return Brand.findOne({
    category: categoryId,
    normalizedName: normalizedName,
  });
}

async function buildUniqueProductName(baseName, brandId, legacyId, dryRun) {
  var cleanBaseName = toTrimmedString(baseName) || 'Product';
  var candidateName = cleanBaseName;
  var suffix = 2;
  var conflict = null;

  if (dryRun) {
    return cleanBaseName;
  }

  while (true) {
    conflict = await Product.findOne({
      brand: brandId,
      normalizedName: normalizeName(candidateName),
      legacyId: { $ne: legacyId },
    }).select('_id');

    if (!conflict) {
      return candidateName;
    }

    candidateName = cleanBaseName + ' ' + suffix;
    suffix += 1;
  }
}

async function upsertProduct(payload, categoryDoc, brandDoc, dryRun) {
  var legacyId = toTrimmedString(payload.legacyId) || undefined;
  var productName = await buildUniqueProductName(payload.productName, brandDoc._id, legacyId, dryRun);
  var filter = legacyId
    ? { legacyId: legacyId }
    : {
      brand: brandDoc._id,
      normalizedName: normalizeName(productName),
    };

  if (dryRun) {
    return {
      _id: String(brandDoc._id) + ':' + normalizeName(productName),
      name: productName,
    };
  }

  await Product.findOneAndUpdate(
    filter,
    {
      $set: {
        legacyId: legacyId,
        category: categoryDoc._id,
        brand: brandDoc._id,
        name: productName,
        normalizedName: normalizeName(productName),
        slug: slugify(productName),
        description: payload.description || payload.spec || '',
        spec: payload.spec || '',
        price: payload.price,
        compareAtPrice: null,
        quantity: payload.quantity,
        imageUrl: toTrimmedString(payload.imageUrl),
        searchKeywords: uniqueArray([payload.categoryName, payload.brandName, productName]),
        status: 'active',
        isActive: true,
      },
    },
    {
      upsert: true,
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      context: 'query',
    }
  );

  return Product.findOne(filter);
}

async function ensureIndexes(dryRun) {
  if (dryRun) {
    return;
  }

  await Promise.all([
    Category.createIndexes(),
    Brand.createIndexes(),
    Product.createIndexes(),
  ]);
}

async function migrate() {
  var isDryRun = process.argv.indexOf('--dry-run') !== -1;
  var shouldClearExisting = process.argv.indexOf('--clear-existing') !== -1;
  var connected = await database.connectToDatabase();
  var legacyState = null;
  var legacyData = null;
  var effectiveProducts = [];
  var categoryNames = [];
  var categoryMap = Object.create(null);
  var brandMap = Object.create(null);
  var summary = {
    categories: 0,
    brands: 0,
    products: 0,
  };

  if (!connected) {
    throw new Error('MongoDB is not configured or reachable.');
  }

  legacyState = await loadLegacyAdminState();
  legacyData = normalizeLegacyData(legacyState);
  effectiveProducts = buildEffectiveProducts(legacyData);

  if (!effectiveProducts.length && !legacyData.categories.length) {
    throw new Error('No legacy catalog data found to migrate.');
  }

  await ensureIndexes(isDryRun);

  if (shouldClearExisting && !isDryRun) {
    await Promise.all([
      Product.deleteMany({}),
      Brand.deleteMany({}),
      Category.deleteMany({}),
    ]);
  }

  categoryNames = uniqueArray(
    legacyData.categories.map(function (entry) { return entry.name; }).concat(
      effectiveProducts.map(function (entry) { return entry.categoryName; })
    )
  );

  for (var categoryIndex = 0; categoryIndex < categoryNames.length; categoryIndex += 1) {
    var categoryName = categoryNames[categoryIndex];
    var categorySource = legacyData.categories.find(function (entry) {
      return normalizeName(entry.name) === normalizeName(categoryName);
    });
    var savedCategory = await upsertCategory(
      categoryName,
      categorySource ? categorySource.description : '',
      isDryRun
    );

    if (!savedCategory) {
      continue;
    }

    categoryMap[normalizeName(categoryName)] = savedCategory;
    summary.categories += 1;
  }

  for (var productIndex = 0; productIndex < effectiveProducts.length; productIndex += 1) {
    var product = effectiveProducts[productIndex];
    var category = categoryMap[normalizeName(product.categoryName)];
    var brand = null;

    if (!category) {
      continue;
    }

    brand = brandMap[normalizeName(product.categoryName) + ':' + normalizeName(product.brandName)];

    if (!brand) {
      brand = await upsertBrand(category._id, product.brandName, isDryRun);
      if (brand) {
        brandMap[normalizeName(product.categoryName) + ':' + normalizeName(product.brandName)] = brand;
        summary.brands += 1;
      }
    }

    if (!brand) {
      continue;
    }

    await upsertProduct(product, category, brand, isDryRun);
    summary.products += 1;
  }

  console.log('');
  console.log(isDryRun ? 'Dry run complete.' : 'Migration complete.');
  console.log(JSON.stringify(summary, null, 2));
  console.log('');
}

migrate()
  .then(function () {
    process.exit(0);
  })
  .catch(function (error) {
    console.error('Migration failed:', error && error.message ? error.message : error);
    process.exit(1);
  });
