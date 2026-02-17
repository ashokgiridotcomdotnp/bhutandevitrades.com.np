var express = require('express');
var fs = require('fs');
var path = require('path');
var multer = require('multer');
var database = require('../lib/db');
var AdminState = require('../models/AdminState');
var router = express.Router();

var noImageProductPath = '/images/productParts/no-image.webp';
var defaultProductImagePath = noImageProductPath;
var adminDataFilePath = path.join(__dirname, '..', 'data', 'admin-data.json');
var uploadedProductImagesDirPath = path.join(__dirname, '..', 'public', 'uploads', 'products');
var publicAssetsDirPath = path.join(__dirname, '..', 'public');
var adminStateKey = 'catalog-admin-data';
var hasAttemptedDatabaseBootstrap = false;

function isMongoStorageEnabled() {
  return String(process.env.MONGODB_URI || '').trim().length > 0;
}

function ensureDirectoryExists(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

ensureDirectoryExists(uploadedProductImagesDirPath);

var imageUploadStorage = multer.diskStorage({
  destination: function (req, file, callback) {
    callback(null, uploadedProductImagesDirPath);
  },
  filename: function (req, file, callback) {
    var extension = path.extname(file.originalname || '').toLowerCase();
    var baseName = path
      .basename(file.originalname || 'image', extension)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    var uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    var safeExtension = extension || '.webp';
    callback(null, (baseName || 'image') + '-' + uniqueSuffix + safeExtension);
  },
});

var imageUpload = multer({
  storage: imageUploadStorage,
  limits: {
    fileSize: 5 * 1024 * 1024,
  },
  fileFilter: function (req, file, callback) {
    if (file && file.mimetype && file.mimetype.indexOf('image/') === 0) {
      callback(null, true);
      return;
    }

    callback(new Error('invalid-image-file'));
  },
});

var baseCategoryGroups = [
  {
    name: 'Engine Oil',
    description: 'Top bike and scooter oil brands',
    items: [],
  },
  {
    name: 'Tyres',
    description: 'Popular tyre sizes',
    items: [],
  },
  {
    name: 'Helmet',
    description: 'Safety helmets in all sizes',
    items: [],
  },
  {
    name: 'Chain Sprocket',
    description: 'Bike model specific sets',
    items: [],
  },
  {
    name: 'Grease',
    description: 'Wheel and bearing grease',
    items: [],
  },
  {
    name: 'Shock',
    description: 'Front and rear suspension parts',
    items: [],
  },
];

var baseProductSections = [];

var baseCategoryKeywordMap = {
  'engine oil': ['engine oil', 'oil'],
  tyres: ['tyre', 'tyres'],
  helmet: ['helmet', 'helmets'],
  'chain sprocket': ['chain sprocket', 'chain set', 'sprocket'],
  grease: ['grease'],
  shock: ['shock', 'suspension'],
};

var homeCarouselImages = [
  '/images/productParts/slidePasal.webp',
  '/images/productParts/slidePasal2.webp',
  '/images/productParts/slidePasal3.webp',
  '/images/productParts/helmet1.webp',
];

var adminData = loadAdminDataFromFile();

refreshAdminData().catch(function (error) {
  console.error('Initial admin data refresh failed:', error.message);
});

function normalizeForSearch(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokenizeQuery(query) {
  var normalized = normalizeForSearch(query);
  return normalized ? normalized.split(' ') : [];
}

function includesQuery(value, query) {
  var terms = tokenizeQuery(query);
  if (terms.length === 0) {
    return true;
  }

  var normalizedValue = normalizeForSearch(value);
  var compactValue = normalizedValue.replace(/\s+/g, '');
  var compactQuery = terms.join('');

  if (compactQuery && compactValue.indexOf(compactQuery) !== -1) {
    return true;
  }

  return terms.every(function (term) {
    return normalizedValue.indexOf(term) !== -1;
  });
}

function toTrimmedString(value) {
  return String(value || '').trim();
}

function parseCommaSeparatedList(value) {
  return normalizeList(String(value || '').split(/[,\n]+/));
}

function normalizeAssetPath(value) {
  var trimmed = toTrimmedString(value);
  if (!trimmed) {
    return '';
  }

  if (trimmed.indexOf('/images/helmets/') === 0) {
    trimmed = trimmed.replace('/images/helmets/', '/images/productParts/');
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  if (trimmed.charAt(0) === '/') {
    return trimmed;
  }

  return '/' + trimmed.replace(/^\/+/, '');
}

function getPublicFilePathFromAssetPath(assetPath) {
  var normalizedPath = normalizeAssetPath(assetPath);
  var cleanPath = '';
  var decodedPath = '';
  var relativePath = '';
  var resolvedPath = '';

  if (!normalizedPath || /^https?:\/\//i.test(normalizedPath)) {
    return '';
  }

  cleanPath = normalizedPath.split('?')[0].split('#')[0];

  try {
    decodedPath = decodeURIComponent(cleanPath);
  } catch (error) {
    decodedPath = cleanPath;
  }

  relativePath = decodedPath.replace(/^\/+/, '');
  resolvedPath = path.resolve(path.join(publicAssetsDirPath, relativePath));

  if (resolvedPath.indexOf(path.resolve(publicAssetsDirPath)) !== 0) {
    return '';
  }

  return resolvedPath;
}

function doesImageAssetExist(assetPath) {
  var publicFilePath = getPublicFilePathFromAssetPath(assetPath);
  if (!publicFilePath) {
    return false;
  }

  return fs.existsSync(publicFilePath);
}

function ensureRenderableImagePath(assetPath) {
  var normalizedPath = normalizeAssetPath(assetPath);

  if (!normalizedPath) {
    return defaultProductImagePath;
  }

  if (/^https?:\/\//i.test(normalizedPath)) {
    return normalizedPath;
  }

  return doesImageAssetExist(normalizedPath) ? normalizedPath : defaultProductImagePath;
}

function getUploadedImagePath(file) {
  if (!file || !file.filename) {
    return '';
  }

  return '/uploads/products/' + file.filename;
}

function getProductOverrideEntry(productId) {
  var cleanId = toTrimmedString(productId);
  if (!cleanId || !adminData || !adminData.productOverrides || typeof adminData.productOverrides !== 'object') {
    return {};
  }

  var entry = adminData.productOverrides[cleanId];
  return entry && typeof entry === 'object' ? entry : {};
}

function isDeletedProduct(productId) {
  var cleanId = toTrimmedString(productId);
  if (!cleanId || !adminData || !Array.isArray(adminData.deletedProductIds)) {
    return false;
  }

  return adminData.deletedProductIds.indexOf(cleanId) !== -1;
}

function getCategoryKeywordCandidates(categoryName) {
  var normalizedName = normalizeForSearch(categoryName);
  var keywordCandidates = [];

  if (!normalizedName) {
    return [];
  }

  keywordCandidates.push(normalizedName);

  if (baseCategoryKeywordMap && Array.isArray(baseCategoryKeywordMap[normalizedName])) {
    keywordCandidates = mergeUniqueValues(keywordCandidates, baseCategoryKeywordMap[normalizedName]);
  }

  if (normalizedName.length > 1 && normalizedName.charAt(normalizedName.length - 1) === 's') {
    keywordCandidates.push(normalizedName.slice(0, -1));
  } else {
    keywordCandidates.push(normalizedName + 's');
  }

  return normalizeList(keywordCandidates).map(function (value) {
    return normalizeForSearch(value);
  });
}

function doCategoryKeywordsMatch(leftName, rightName) {
  var leftKeywords = getCategoryKeywordCandidates(leftName);
  var rightKeywords = getCategoryKeywordCandidates(rightName);
  var leftIndex = Object.create(null);
  var leftKey = normalizeForSearch(leftName);
  var rightKey = normalizeForSearch(rightName);

  if (!leftKey || !rightKey) {
    return false;
  }

  if (
    leftKey === rightKey ||
    leftKey.indexOf(rightKey) !== -1 ||
    rightKey.indexOf(leftKey) !== -1
  ) {
    return true;
  }

  leftKeywords.forEach(function (keyword) {
    leftIndex[keyword] = true;
  });

  for (var index = 0; index < rightKeywords.length; index += 1) {
    var keyword = rightKeywords[index];
    if (!keyword) {
      continue;
    }

    if (leftIndex[keyword]) {
      return true;
    }
  }

  return false;
}

function isDeletedCategory(categoryName) {
  var cleanCategoryName = toTrimmedString(categoryName);
  var targetKey = normalizeForSearch(cleanCategoryName);

  if (!targetKey || !adminData || !Array.isArray(adminData.deletedCategoryNames)) {
    return false;
  }

  return adminData.deletedCategoryNames.some(function (storedCategoryName) {
    return doCategoryKeywordsMatch(storedCategoryName, cleanCategoryName);
  });
}

function removeDeletedCategory(categoryName) {
  var targetName = toTrimmedString(categoryName);
  var targetKey = normalizeForSearch(targetName);

  if (!targetKey || !adminData || !Array.isArray(adminData.deletedCategoryNames)) {
    return;
  }

  adminData.deletedCategoryNames = adminData.deletedCategoryNames.filter(function (storedCategoryName) {
    return !doCategoryKeywordsMatch(storedCategoryName, targetName);
  });
}

function normalizeList(values) {
  var list = Array.isArray(values) ? values : [];
  var seen = Object.create(null);
  var normalizedValues = [];

  list.forEach(function (value) {
    var trimmed = toTrimmedString(value);
    var key = normalizeForSearch(trimmed);

    if (!trimmed || !key || seen[key]) {
      return;
    }

    seen[key] = true;
    normalizedValues.push(trimmed);
  });

  return normalizedValues;
}

function mergeUniqueValues(firstList, secondList) {
  return normalizeList([].concat(firstList || [], secondList || []));
}

function getEffectivePrice(productId, fallbackPrice) {
  var cleanId = toTrimmedString(productId);
  var defaultPrice = toTrimmedString(fallbackPrice);
  var productOverridePrice = toTrimmedString(getProductOverrideEntry(cleanId).price);
  var overridePrice = '';

  if (
    cleanId &&
    adminData &&
    adminData.priceOverrides &&
    typeof adminData.priceOverrides === 'object'
  ) {
    overridePrice = toTrimmedString(adminData.priceOverrides[cleanId]);
  }

  return productOverridePrice || overridePrice || defaultPrice;
}

function getEffectiveImage(productId, fallbackImage) {
  var cleanId = toTrimmedString(productId);
  var productOverrideImage = ensureRenderableImagePath(getProductOverrideEntry(cleanId).image);
  var defaultImage = ensureRenderableImagePath(fallbackImage) || defaultProductImagePath;
  var overrideImage = '';

  if (
    cleanId &&
    adminData &&
    adminData.imageOverrides &&
    typeof adminData.imageOverrides === 'object'
  ) {
    overrideImage = ensureRenderableImagePath(adminData.imageOverrides[cleanId]);
  }

  return ensureRenderableImagePath(productOverrideImage || overrideImage || defaultImage);
}

function normalizeImageList(images, fallbackImage) {
  var normalizedImages = normalizeList((images || []).map(function (imagePath) {
    return ensureRenderableImagePath(imagePath);
  }));
  var primaryImage = ensureRenderableImagePath(fallbackImage);

  if (primaryImage) {
    normalizedImages = [primaryImage].concat(normalizedImages);
  }

  normalizedImages = normalizeList(normalizedImages);
  if (normalizedImages.length === 0) {
    normalizedImages.push(defaultProductImagePath);
  }

  return normalizedImages;
}

function cloneCategoryGroups(groups) {
  return (groups || []).map(function (group) {
    return {
      name: toTrimmedString(group.name),
      description: toTrimmedString(group.description),
      items: normalizeList(group.items),
    };
  });
}

function cloneProductSections(sections) {
  return (sections || []).map(function (section) {
    return {
      title: toTrimmedString(section.title),
      subtitle: toTrimmedString(section.subtitle),
      items: (section.items || [])
        .filter(function (item) {
          return !isDeletedProduct(item.id);
        })
        .map(function (item) {
          var itemId = toTrimmedString(item.id);
          var productOverride = getProductOverrideEntry(itemId);
          var effectiveType = toTrimmedString(productOverride.type) || toTrimmedString(item.type);
          if (isDeletedCategory(effectiveType)) {
            return null;
          }

          var effectiveName = toTrimmedString(productOverride.name) || toTrimmedString(item.name);
          var effectiveSpec = toTrimmedString(productOverride.spec) || toTrimmedString(item.spec);
          var effectiveImage = getEffectiveImage(itemId, productOverride.image || item.image);
          return {
            id: itemId,
            type: effectiveType,
            name: effectiveName,
            spec: effectiveSpec,
            price: getEffectivePrice(itemId, productOverride.price || item.price),
            image: effectiveImage,
            images: normalizeImageList(item.images, effectiveImage),
          };
        })
        .filter(Boolean),
    };
  });
}

function ensureAdminCategoryShape(rawCategory) {
  if (!rawCategory || typeof rawCategory !== 'object') {
    return null;
  }

  var categoryName = toTrimmedString(rawCategory.name);
  if (!categoryName) {
    return null;
  }

  return {
    name: categoryName,
    description: toTrimmedString(rawCategory.description) || 'Added from admin panel',
    items: normalizeList(rawCategory.items),
  };
}

function ensureAdminProductShape(rawProduct) {
  if (!rawProduct || typeof rawProduct !== 'object') {
    return null;
  }

  var type = toTrimmedString(rawProduct.type);
  var name = toTrimmedString(rawProduct.name);

  if (!type || !name) {
    return null;
  }

  var image = ensureRenderableImagePath(rawProduct.image) || defaultProductImagePath;

  return {
    id: buildSlug(rawProduct.id) || buildSlug(type + ' ' + name) || String(Date.now()),
    type: type,
    name: name,
    spec: toTrimmedString(rawProduct.spec) || 'N/A',
    price: toTrimmedString(rawProduct.price) || 'Contact for price',
    image: image,
    images: normalizeImageList(rawProduct.images, image),
  };
}

function createDefaultAdminData() {
  return {
    categories: [],
    products: [],
    priceOverrides: {},
    imageOverrides: {},
    productOverrides: {},
    deletedProductIds: [],
    deletedCategoryNames: [],
  };
}

function normalizeAdminDataShape(rawData) {
  var safeData = createDefaultAdminData();

  if (!rawData || typeof rawData !== 'object') {
    return safeData;
  }

  if (Array.isArray(rawData.categories)) {
    rawData.categories.forEach(function (category) {
      var safeCategory = ensureAdminCategoryShape(category);
      if (safeCategory) {
        safeData.categories.push(safeCategory);
      }
    });
  }

  if (Array.isArray(rawData.products)) {
    rawData.products.forEach(function (product) {
      var safeProduct = ensureAdminProductShape(product);
      if (safeProduct) {
        safeData.products.push(safeProduct);
      }
    });
  }

  if (rawData.priceOverrides && typeof rawData.priceOverrides === 'object') {
    Object.keys(rawData.priceOverrides).forEach(function (productId) {
      var cleanId = toTrimmedString(productId);
      var cleanPrice = toTrimmedString(rawData.priceOverrides[productId]);
      if (!cleanId || !cleanPrice) {
        return;
      }
      safeData.priceOverrides[cleanId] = cleanPrice;
    });
  }

  if (rawData.imageOverrides && typeof rawData.imageOverrides === 'object') {
    Object.keys(rawData.imageOverrides).forEach(function (productId) {
      var cleanId = toTrimmedString(productId);
      var cleanImage = normalizeAssetPath(rawData.imageOverrides[productId]);
      if (!cleanId || !cleanImage) {
        return;
      }
      safeData.imageOverrides[cleanId] = cleanImage;
    });
  }

  if (rawData.productOverrides && typeof rawData.productOverrides === 'object') {
    Object.keys(rawData.productOverrides).forEach(function (productId) {
      var cleanId = toTrimmedString(productId);
      var rawOverride = rawData.productOverrides[productId];
      var normalizedOverride = {};

      if (!cleanId || !rawOverride || typeof rawOverride !== 'object') {
        return;
      }

      var cleanType = toTrimmedString(rawOverride.type);
      var cleanName = toTrimmedString(rawOverride.name);
      var cleanSpec = toTrimmedString(rawOverride.spec);
      var cleanPrice = toTrimmedString(rawOverride.price);
      var cleanImage = normalizeAssetPath(rawOverride.image);

      if (cleanType) {
        normalizedOverride.type = cleanType;
      }

      if (cleanName) {
        normalizedOverride.name = cleanName;
      }

      if (cleanSpec) {
        normalizedOverride.spec = cleanSpec;
      }

      if (cleanPrice) {
        normalizedOverride.price = cleanPrice;
      }

      if (cleanImage) {
        normalizedOverride.image = cleanImage;
      }

      if (Object.keys(normalizedOverride).length > 0) {
        safeData.productOverrides[cleanId] = normalizedOverride;
      }
    });
  }

  if (Array.isArray(rawData.deletedProductIds)) {
    safeData.deletedProductIds = normalizeList(rawData.deletedProductIds);
  }

  if (Array.isArray(rawData.deletedCategoryNames)) {
    safeData.deletedCategoryNames = normalizeList(rawData.deletedCategoryNames);
  }

  return safeData;
}

function loadAdminDataFromFile() {
  try {
    if (!fs.existsSync(adminDataFilePath)) {
      return createDefaultAdminData();
    }

    var content = fs.readFileSync(adminDataFilePath, 'utf8');
    if (!content.trim()) {
      return createDefaultAdminData();
    }

    return normalizeAdminDataShape(JSON.parse(content));
  } catch (error) {
    console.error('Failed to load admin data from file:', error.message);
    return createDefaultAdminData();
  }
}

function saveAdminDataToFile() {
  try {
    var directoryPath = path.dirname(adminDataFilePath);
    if (!fs.existsSync(directoryPath)) {
      fs.mkdirSync(directoryPath, { recursive: true });
    }

    fs.writeFileSync(adminDataFilePath, JSON.stringify(normalizeAdminDataShape(adminData), null, 2) + '\n', 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to save admin data to file:', error.message);
    return false;
  }
}

async function loadAdminDataFromDatabase() {
  var isConnected = await database.connectToDatabase();
  if (!isConnected) {
    return false;
  }

  try {
    var state = await AdminState.findOne({ key: adminStateKey }).lean();
    if (!state || !state.payload || typeof state.payload !== 'object') {
      return false;
    }

    adminData = normalizeAdminDataShape(state.payload);
    return true;
  } catch (error) {
    console.error('Failed to load admin data from database:', error.message);
    return false;
  }
}

async function refreshAdminData() {
  var loadedFromDatabase = await loadAdminDataFromDatabase();
  if (loadedFromDatabase) {
    return true;
  }

  adminData = loadAdminDataFromFile();

  if (isMongoStorageEnabled() && !hasAttemptedDatabaseBootstrap) {
    hasAttemptedDatabaseBootstrap = true;
    await saveAdminData();
  }

  return true;
}

async function saveAdminData() {
  var normalizedData = normalizeAdminDataShape(adminData);
  adminData = normalizedData;
  var isConnected = await database.connectToDatabase();

  if (isConnected) {
    try {
      await AdminState.findOneAndUpdate(
        { key: adminStateKey },
        {
          key: adminStateKey,
          payload: normalizedData,
          updatedAt: new Date(),
        },
        {
          upsert: true,
          setDefaultsOnInsert: true,
        }
      );

      saveAdminDataToFile();
      return true;
    } catch (error) {
      console.error('Failed to save admin data to database:', error.message);
      return false;
    }
  }

  return saveAdminDataToFile();
}

function getMergedCategoryGroups() {
  var mergedCategories = cloneCategoryGroups(baseCategoryGroups).filter(function (group) {
    return !isDeletedCategory(group.name);
  });
  var categoryIndexByKey = Object.create(null);

  mergedCategories.forEach(function (group, index) {
    var groupKey = normalizeForSearch(group.name);
    if (groupKey) {
      categoryIndexByKey[groupKey] = index;
    }
  });

  adminData.categories.forEach(function (category) {
    if (isDeletedCategory(category.name)) {
      return;
    }

    var categoryKey = normalizeForSearch(category.name);
    if (!categoryKey) {
      return;
    }

    if (typeof categoryIndexByKey[categoryKey] === 'number') {
      var existingCategory = mergedCategories[categoryIndexByKey[categoryKey]];
      if (category.description) {
        existingCategory.description = category.description;
      }
      existingCategory.items = mergeUniqueValues(existingCategory.items, category.items);
      return;
    }

    mergedCategories.push({
      name: category.name,
      description: category.description || 'Added from admin panel',
      items: normalizeList(category.items),
    });
    categoryIndexByKey[categoryKey] = mergedCategories.length - 1;
  });

  adminData.products.forEach(function (product) {
    if (isDeletedProduct(product.id)) {
      return;
    }

    var productOverride = getProductOverrideEntry(product.id);
    var effectiveCategoryName = toTrimmedString(productOverride.type) || toTrimmedString(product.type);
    if (isDeletedCategory(effectiveCategoryName)) {
      return;
    }

    var effectiveProductName = toTrimmedString(productOverride.name) || toTrimmedString(product.name);
    var productCategoryKey = normalizeForSearch(effectiveCategoryName);
    if (!productCategoryKey) {
      return;
    }

    var categoryIndex = categoryIndexByKey[productCategoryKey];
    if (typeof categoryIndex !== 'number') {
      mergedCategories.push({
        name: effectiveCategoryName,
        description: 'Added from admin panel',
        items: [],
      });
      categoryIndex = mergedCategories.length - 1;
      categoryIndexByKey[productCategoryKey] = categoryIndex;
    }

    mergedCategories[categoryIndex].items = mergeUniqueValues(mergedCategories[categoryIndex].items, [effectiveProductName]);
  });

  return mergedCategories;
}

function getMergedProductSections() {
  var mergedSections = cloneProductSections(baseProductSections);
  var adminSectionMap = Object.create(null);

  adminData.products.forEach(function (product) {
    if (isDeletedProduct(product.id)) {
      return;
    }

    var productOverride = getProductOverrideEntry(product.id);
    var effectiveCategoryName = toTrimmedString(productOverride.type) || toTrimmedString(product.type) || 'Other';
    if (isDeletedCategory(effectiveCategoryName)) {
      return;
    }

    var effectiveName = toTrimmedString(productOverride.name) || toTrimmedString(product.name);
    var effectiveSpec = toTrimmedString(productOverride.spec) || toTrimmedString(product.spec);
    var effectivePrice = getEffectivePrice(product.id, productOverride.price || product.price);
    var sectionKey = normalizeForSearch(effectiveCategoryName) || 'other';

    if (!adminSectionMap[sectionKey]) {
      adminSectionMap[sectionKey] = {
        title: effectiveCategoryName + ' (Admin)',
        subtitle: 'Products added from admin panel',
        items: [],
      };
    }

    var effectiveImage = getEffectiveImage(product.id, productOverride.image || product.image || defaultProductImagePath);

    adminSectionMap[sectionKey].items.push({
      id: product.id,
      type: effectiveCategoryName,
      name: effectiveName,
      spec: effectiveSpec,
      price: effectivePrice,
      image: effectiveImage,
      images: normalizeImageList(product.images, effectiveImage),
    });
  });

  Object.keys(adminSectionMap)
    .sort()
    .forEach(function (sectionKey) {
      mergedSections.push(adminSectionMap[sectionKey]);
    });

  return mergedSections;
}

function getMergedCategoryKeywordMap(categoryGroups) {
  var keywordMap = {};

  Object.keys(baseCategoryKeywordMap).forEach(function (key) {
    keywordMap[key] = normalizeList(baseCategoryKeywordMap[key]);
  });

  categoryGroups.forEach(function (group) {
    var groupKey = normalizeForSearch(group.name);
    if (!groupKey) {
      return;
    }

    keywordMap[groupKey] = mergeUniqueValues(keywordMap[groupKey] || [], [group.name].concat(group.items || []));
  });

  return keywordMap;
}

function syncCategoryGroupsWithProducts(categoryGroups, productSections, categoryKeywordMap) {
  var syncedGroups = cloneCategoryGroups(categoryGroups);
  var groupIndexByKey = Object.create(null);

  syncedGroups.forEach(function (group, index) {
    var key = normalizeForSearch(group.name);
    if (key) {
      groupIndexByKey[key] = index;
    }
  });

  (productSections || []).forEach(function (section) {
    (section.items || []).forEach(function (item) {
      if (!item || !item.name) {
        return;
      }

      var resolvedCategoryName = resolveBoardCategoryName(item.type, syncedGroups, categoryKeywordMap);
      var categoryKey = normalizeForSearch(resolvedCategoryName);
      var groupIndex = groupIndexByKey[categoryKey];

      if (typeof groupIndex !== 'number') {
        syncedGroups.push({
          name: resolvedCategoryName,
          description: 'Products available',
          items: [],
        });
        groupIndex = syncedGroups.length - 1;
        groupIndexByKey[categoryKey] = groupIndex;
      }

      syncedGroups[groupIndex].items = mergeUniqueValues(syncedGroups[groupIndex].items, [item.name]);
    });
  });

  return syncedGroups;
}

function syncCategoryGroupsWithAdminBoards(categoryGroups, categoryBoards) {
  var syncedGroups = cloneCategoryGroups(categoryGroups);
  var boardByKey = Object.create(null);

  (categoryBoards || []).forEach(function (board) {
    var boardKey = normalizeForSearch(board && board.name);
    if (!boardKey || boardByKey[boardKey]) {
      return;
    }

    boardByKey[boardKey] = board;
  });

  syncedGroups.forEach(function (group) {
    var groupKey = normalizeForSearch(group.name);
    var matchedBoard = boardByKey[groupKey];
    var limitedItemNames = [];

    if (!matchedBoard) {
      return;
    }

    limitedItemNames = (matchedBoard.items || [])
      .map(function (item) {
        return toTrimmedString(item && item.name);
      })
      .filter(Boolean)
      .slice(0, 2);

    group.items = normalizeList(limitedItemNames);
  });

  return syncedGroups;
}

function getCatalogContext() {
  var productSections = getMergedProductSections();
  var categoryGroups = getMergedCategoryGroups();
  var categoryKeywordMap = getMergedCategoryKeywordMap(categoryGroups);
  var categoryBoards = [];

  categoryGroups = syncCategoryGroupsWithProducts(categoryGroups, productSections, categoryKeywordMap);
  categoryBoards = buildAdminCategoryBoards(categoryGroups, productSections, categoryKeywordMap);
  categoryGroups = syncCategoryGroupsWithAdminBoards(categoryGroups, categoryBoards);
  categoryKeywordMap = getMergedCategoryKeywordMap(categoryGroups);

  return {
    categoryGroups: categoryGroups,
    productSections: productSections,
    categoryKeywordMap: categoryKeywordMap,
  };
}

function resolveCategoryName(rawCategory, categoryGroups) {
  if (!rawCategory) {
    return '';
  }

  var normalized = normalizeForSearch(rawCategory);
  var matchedCategory = categoryGroups.find(function (group) {
    return normalizeForSearch(group.name) === normalized;
  });

  return matchedCategory ? matchedCategory.name : '';
}

function buildCategoryViewData(query, selectedCategory, categoryGroups) {
  var hasQuery = Boolean(query);

  return categoryGroups.map(function (group) {
    var matchesGroupText = hasQuery ? includesQuery([group.name, group.description].join(' '), query) : false;
    var items = group.items.map(function (item) {
      var matchesItem = hasQuery ? includesQuery(item, query) : false;
      return {
        label: item,
        isMatch: matchesItem,
      };
    });

    return {
      name: group.name,
      description: group.description,
      isActive: group.name === selectedCategory,
      isMatch: matchesGroupText || items.some(function (item) { return item.isMatch; }),
      items: items,
    };
  });
}

function matchesCategory(item, section, selectedCategory, categoryKeywordMap) {
  if (!selectedCategory) {
    return true;
  }

  var categoryKey = normalizeForSearch(selectedCategory);
  var keywords = categoryKeywordMap[categoryKey] || [categoryKey];
  var searchableText = normalizeForSearch([section.title, section.subtitle, item.type, item.name, item.spec].join(' '));

  return keywords.some(function (keyword) {
    return searchableText.indexOf(normalizeForSearch(keyword)) !== -1;
  });
}

function filterProductData(query, selectedCategory, productSections, categoryKeywordMap) {
  var hasQuery = Boolean(query);

  return productSections
    .map(function (section) {
      var filteredItems = section.items.filter(function (item) {
        var searchableText = [item.type, item.name, item.spec, item.price, item.id].join(' ');
        var queryMatch = hasQuery ? includesQuery(searchableText, query) : true;
        var categoryMatch = matchesCategory(item, section, selectedCategory, categoryKeywordMap);
        return queryMatch && categoryMatch;
      });

      return {
        title: section.title,
        subtitle: section.subtitle,
        items: filteredItems,
      };
    })
    .filter(function (section) {
      return section.items.length > 0;
    });
}

function getOpenCategoryName(groups, selectedCategory, query) {
  if (selectedCategory) {
    return selectedCategory;
  }

  if (query) {
    var matched = groups.find(function (group) {
      return group.isMatch;
    });
    if (matched) {
      return matched.name;
    }
  }

  return '';
}

function countItems(sections) {
  return sections.reduce(function (total, section) {
    return total + section.items.length;
  }, 0);
}

function findProductById(productId, productSections) {
  for (var sectionIndex = 0; sectionIndex < productSections.length; sectionIndex += 1) {
    var section = productSections[sectionIndex];

    for (var itemIndex = 0; itemIndex < section.items.length; itemIndex += 1) {
      var item = section.items[itemIndex];

      if (item.id === productId) {
        return {
          item: item,
          sectionTitle: section.title,
        };
      }
    }
  }

  return null;
}

function buildSearchSuggestions(categoryGroups, productSections) {
  var seen = Object.create(null);
  var suggestions = [];

  function addSuggestion(value) {
    var normalized = normalizeForSearch(value);
    if (!normalized || seen[normalized]) {
      return;
    }

    seen[normalized] = true;
    suggestions.push(String(value));
  }

  categoryGroups.forEach(function (group) {
    addSuggestion(group.name);
    addSuggestion(group.description);
    group.items.forEach(function (item) {
      addSuggestion(item);
    });
  });

  productSections.forEach(function (section) {
    addSuggestion(section.title);
    addSuggestion(section.subtitle);

    section.items.forEach(function (item) {
      addSuggestion(item.name);
      addSuggestion(item.type);
      addSuggestion(item.spec);
      addSuggestion(item.price);
      addSuggestion(item.id);
    });
  });

  return suggestions.slice(0, 30);
}

function buildSlug(value) {
  return normalizeForSearch(value).replace(/\s+/g, '-');
}

function buildUniqueProductId(categoryName, productName, productSections) {
  var baseId = buildSlug(categoryName + ' ' + productName) || 'product';
  var candidateId = baseId;
  var suffix = 2;
  var usedIds = Object.create(null);

  productSections.forEach(function (section) {
    section.items.forEach(function (item) {
      if (item.id) {
        usedIds[item.id] = true;
      }
    });
  });

  while (usedIds[candidateId]) {
    candidateId = baseId + '-' + suffix;
    suffix += 1;
  }

  return candidateId;
}

function buildAdminPriceRows(productSections) {
  var rows = [];

  (productSections || []).forEach(function (section) {
    (section.items || []).forEach(function (item) {
      rows.push({
        id: item.id,
        sectionTitle: section.title,
        type: item.type,
        name: item.name,
        spec: item.spec,
        price: item.price,
      });
    });
  });

  return rows.sort(function (a, b) {
    return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
  });
}

function resolveBoardCategoryName(rawCategoryName, categoryGroups, categoryKeywordMap) {
  var normalizedRawName = normalizeForSearch(rawCategoryName);
  var categoryNameByKey = Object.create(null);
  var categoryKeys = [];

  (categoryGroups || []).forEach(function (group) {
    var key = normalizeForSearch(group.name);
    if (!key || categoryNameByKey[key]) {
      return;
    }
    categoryNameByKey[key] = group.name;
    categoryKeys.push(key);
  });

  if (!normalizedRawName) {
    return 'Other';
  }

  if (categoryNameByKey[normalizedRawName]) {
    return categoryNameByKey[normalizedRawName];
  }

  for (var index = 0; index < categoryKeys.length; index += 1) {
    var categoryKey = categoryKeys[index];
    var keywords = (categoryKeywordMap && categoryKeywordMap[categoryKey]) || [categoryKey];

    for (var keywordIndex = 0; keywordIndex < keywords.length; keywordIndex += 1) {
      var normalizedKeyword = normalizeForSearch(keywords[keywordIndex]);
      if (!normalizedKeyword) {
        continue;
      }

      if (
        normalizedRawName === normalizedKeyword ||
        normalizedRawName.indexOf(normalizedKeyword) !== -1 ||
        normalizedKeyword.indexOf(normalizedRawName) !== -1
      ) {
        return categoryNameByKey[categoryKey];
      }
    }
  }

  return toTrimmedString(rawCategoryName) || 'Other';
}

function buildAdminCategoryBoards(categoryGroups, productSections, categoryKeywordMap) {
  var boardMap = Object.create(null);
  var orderedKeys = [];
  var seenProductIds = Object.create(null);
  var seenBoardItems = Object.create(null);

  function ensureBoard(categoryName) {
    var cleanName = toTrimmedString(categoryName) || 'Other';
    var categoryKey = normalizeForSearch(cleanName) || 'other';

    if (!boardMap[categoryKey]) {
      boardMap[categoryKey] = {
        key: categoryKey,
        name: cleanName,
        items: [],
      };
      orderedKeys.push(categoryKey);
    }

    if (!seenBoardItems[categoryKey]) {
      seenBoardItems[categoryKey] = Object.create(null);
    }

    return boardMap[categoryKey];
  }

  (categoryGroups || []).forEach(function (group) {
    ensureBoard(group.name);
  });

  (productSections || []).forEach(function (section) {
    (section.items || []).forEach(function (item) {
      if (!item || !item.id || seenProductIds[item.id]) {
        return;
      }

      seenProductIds[item.id] = true;
      var boardName = resolveBoardCategoryName(item.type, categoryGroups, categoryKeywordMap);
      var board = ensureBoard(boardName);
      var boardKey = board.key;
      var boardItemKey = normalizeForSearch([item.name, item.spec].join(' '));

      if (boardItemKey && seenBoardItems[boardKey][boardItemKey]) {
        return;
      }

      if (boardItemKey) {
        seenBoardItems[boardKey][boardItemKey] = true;
      }

      board.items.push({
        id: item.id,
        type: item.type,
        name: item.name,
        spec: item.spec,
        price: item.price,
        image: item.image,
      });
    });
  });

  return orderedKeys.map(function (key) {
    var board = boardMap[key];
    board.items.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    return board;
  });
}

function findAdminCategoryByName(categoryName) {
  var categoryKey = normalizeForSearch(categoryName);
  if (!categoryKey) {
    return null;
  }

  return adminData.categories.find(function (category) {
    return normalizeForSearch(category.name) === categoryKey;
  }) || null;
}

function upsertAdminCategory(categoryName, categoryDescription, categoryItems) {
  var cleanedName = toTrimmedString(categoryName);
  if (!cleanedName) {
    return null;
  }

  removeDeletedCategory(cleanedName);

  var existingCategory = findAdminCategoryByName(cleanedName);
  if (!existingCategory) {
    existingCategory = {
      name: cleanedName,
      description: toTrimmedString(categoryDescription) || 'Added from admin panel',
      items: normalizeList(categoryItems),
    };
    adminData.categories.push(existingCategory);
    return existingCategory;
  }

  existingCategory.name = cleanedName;

  if (toTrimmedString(categoryDescription)) {
    existingCategory.description = toTrimmedString(categoryDescription);
  }

  if (Array.isArray(categoryItems) && categoryItems.length > 0) {
    existingCategory.items = mergeUniqueValues(existingCategory.items, categoryItems);
  }

  return existingCategory;
}

function getAdminStatusMessage(statusCode) {
  if (statusCode === 'image-saved') {
    return 'Image updated successfully.';
  }

  if (statusCode === 'price-saved') {
    return 'Price updated successfully.';
  }

  if (statusCode === 'category-saved') {
    return 'Category saved successfully.';
  }

  if (statusCode === 'product-saved') {
    return 'Product saved successfully.';
  }

  if (statusCode === 'product-updated') {
    return 'Product updated successfully.';
  }

  if (statusCode === 'product-deleted') {
    return 'Product deleted successfully.';
  }

  if (statusCode === 'category-deleted') {
    return 'Category deleted successfully.';
  }

  return '';
}

function getAdminErrorMessage(errorCode) {
  if (errorCode === 'invalid-image-file') {
    return 'Please upload a valid image file.';
  }

  if (errorCode === 'image-too-large') {
    return 'Image file is too large. Max size is 5MB.';
  }

  if (errorCode === 'product-image-file-required') {
    return 'Image file is required.';
  }

  if (errorCode === 'product-image-required') {
    return 'Image path is required.';
  }

  if (errorCode === 'product-id-required') {
    return 'Product ID is required.';
  }

  if (errorCode === 'product-price-required') {
    return 'Price is required.';
  }

  if (errorCode === 'product-not-found') {
    return 'Product was not found.';
  }

  if (errorCode === 'category-name-required') {
    return 'Category name is required.';
  }

  if (errorCode === 'category-not-found') {
    return 'Category was not found.';
  }

  if (errorCode === 'product-category-required') {
    return 'Product category is required.';
  }

  if (errorCode === 'product-name-required') {
    return 'Product name is required.';
  }

  if (errorCode === 'save-failed') {
    return 'Could not save data. Check file permissions and try again.';
  }

  return '';
}

router.use(async function (req, res, next) {
  try {
    await refreshAdminData();
  } catch (error) {
    console.error('Failed to refresh admin data:', error.message);
  }

  next();
});

function renderHomePage(req, res, next) {
  var catalog = getCatalogContext();
  var q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  var rawCategory = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  var query = q;
  var selectedCategory = resolveCategoryName(rawCategory, catalog.categoryGroups);
  var isHomeRoute = req.path === '/home' || req.path === '/home/';
  var isRootRoute = req.path === '/';
  var hasActiveFilters = q.length > 0 || Boolean(selectedCategory);
  var showCarousel = isRootRoute && !hasActiveFilters;
  var basePath = isHomeRoute ? '/home' : '/';
  var categoryGroupsForView = buildCategoryViewData(query, selectedCategory, catalog.categoryGroups);
  var filteredProductSections = filterProductData(query, selectedCategory, catalog.productSections, catalog.categoryKeywordMap);
  var openCategoryName = getOpenCategoryName(categoryGroupsForView, selectedCategory, query);

  res.render('index', {
    title: 'BhutanDevi Trade and Suppliers',
    q: q,
    activeCategory: selectedCategory,
    hasFilters: hasActiveFilters,
    hasQuery: q.length > 0,
    totalResults: countItems(filteredProductSections),
    openCategoryName: openCategoryName,
    categoryGroups: categoryGroupsForView,
    productSections: filteredProductSections,
    searchSuggestions: buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    showCarousel: showCarousel,
    carouselImages: homeCarouselImages,
    basePath: basePath,
  });
}

router.get(['/', '/home'], renderHomePage);

router.get('/admin', function (req, res) {
  var catalog = getCatalogContext();
  var status = toTrimmedString(req.query.status);
  var error = toTrimmedString(req.query.error);

  res.render('admin', {
    title: 'Admin Panel | BhutanDevi Trade and Suppliers',
    q: '',
    activeCategory: '',
    statusMessage: getAdminStatusMessage(status),
    errorMessage: getAdminErrorMessage(error),
    categoryBoards: buildAdminCategoryBoards(catalog.categoryGroups, catalog.productSections, catalog.categoryKeywordMap),
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
});

router.post('/admin/prices', async function (req, res) {
  var productId = toTrimmedString(req.body.productId);
  var productPrice = toTrimmedString(req.body.productPrice);
  var catalog = getCatalogContext();

  if (!productId) {
    return res.redirect('/admin?error=product-id-required');
  }

  if (!productPrice) {
    return res.redirect('/admin?error=product-price-required');
  }

  if (!findProductById(productId, catalog.productSections)) {
    return res.redirect('/admin?error=product-not-found');
  }

  adminData.priceOverrides[productId] = productPrice;

  if (!await saveAdminData()) {
    return res.redirect('/admin?error=save-failed');
  }

  return res.redirect('/admin?status=price-saved');
});

router.post('/admin/images', function (req, res) {
  imageUpload.single('productImageFile')(req, res, async function (uploadError) {
    if (uploadError) {
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        return res.redirect('/admin?error=image-too-large');
      }

      if (uploadError.message === 'invalid-image-file') {
        return res.redirect('/admin?error=invalid-image-file');
      }

      return res.redirect('/admin?error=save-failed');
    }

    var productId = toTrimmedString(req.body.productId);
    var uploadedImagePath = getUploadedImagePath(req.file);
    var catalog = getCatalogContext();

    if (!productId) {
      return res.redirect('/admin?error=product-id-required');
    }

    if (!uploadedImagePath) {
      return res.redirect('/admin?error=product-image-file-required');
    }

    if (!findProductById(productId, catalog.productSections)) {
      return res.redirect('/admin?error=product-not-found');
    }

    adminData.imageOverrides[productId] = uploadedImagePath;

    if (!await saveAdminData()) {
      return res.redirect('/admin?error=save-failed');
    }

    return res.redirect('/admin?status=image-saved');
  });
});

router.post('/admin/products/edit', function (req, res) {
  imageUpload.single('productImageFile')(req, res, async function (uploadError) {
    if (uploadError) {
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        return res.redirect('/admin?error=image-too-large');
      }

      if (uploadError.message === 'invalid-image-file') {
        return res.redirect('/admin?error=invalid-image-file');
      }

      return res.redirect('/admin?error=save-failed');
    }

    var productId = toTrimmedString(req.body.productId);
    var productCategory = toTrimmedString(req.body.productCategory);
    var productName = toTrimmedString(req.body.productName);
    var productSpec = toTrimmedString(req.body.productSpec) || 'N/A';
    var productPrice = toTrimmedString(req.body.productPrice);
    var currentImagePath = normalizeAssetPath(req.body.currentImagePath);
    var uploadedImagePath = getUploadedImagePath(req.file);
    var catalog = getCatalogContext();
    var productMatch = findProductById(productId, catalog.productSections);
    var resolvedImagePath = '';

    if (!productId) {
      return res.redirect('/admin?error=product-id-required');
    }

    if (!productCategory) {
      return res.redirect('/admin?error=product-category-required');
    }

    if (!productName) {
      return res.redirect('/admin?error=product-name-required');
    }

    if (!productPrice) {
      return res.redirect('/admin?error=product-price-required');
    }

    if (!productMatch) {
      return res.redirect('/admin?error=product-not-found');
    }

    resolvedImagePath =
      uploadedImagePath ||
      currentImagePath ||
      normalizeAssetPath(productMatch.item.image) ||
      defaultProductImagePath;

    if (!adminData.productOverrides || typeof adminData.productOverrides !== 'object') {
      adminData.productOverrides = {};
    }

    adminData.productOverrides[productId] = {
      type: productCategory,
      name: productName,
      spec: productSpec,
      price: productPrice,
      image: resolvedImagePath,
    };

    upsertAdminCategory(productCategory, '', [productName]);

    if (adminData.priceOverrides && typeof adminData.priceOverrides === 'object') {
      delete adminData.priceOverrides[productId];
    }

    if (adminData.imageOverrides && typeof adminData.imageOverrides === 'object') {
      delete adminData.imageOverrides[productId];
    }

    if (Array.isArray(adminData.deletedProductIds)) {
      adminData.deletedProductIds = adminData.deletedProductIds.filter(function (id) {
        return id !== productId;
      });
    }

    if (!await saveAdminData()) {
      return res.redirect('/admin?error=save-failed');
    }

    return res.redirect('/admin?status=product-updated');
  });
});

router.post('/admin/products/delete', async function (req, res) {
  var productId = toTrimmedString(req.body.productId);
  var catalog = getCatalogContext();
  var productMatch = findProductById(productId, catalog.productSections);
  var hasAdminProduct = false;
  var deletedProductNameKey = '';
  var deletedCategoryKey = '';

  if (!productId) {
    return res.redirect('/admin?error=product-id-required');
  }

  if (!productMatch) {
    return res.redirect('/admin?error=product-not-found');
  }

  deletedProductNameKey = normalizeForSearch(productMatch.item.name);
  deletedCategoryKey = normalizeForSearch(productMatch.item.type);

  if (Array.isArray(adminData.products)) {
    var nextAdminProducts = [];
    adminData.products.forEach(function (product) {
      if (product.id === productId) {
        hasAdminProduct = true;
        return;
      }
      nextAdminProducts.push(product);
    });
    adminData.products = nextAdminProducts;
  }

  if (!hasAdminProduct) {
    if (!Array.isArray(adminData.deletedProductIds)) {
      adminData.deletedProductIds = [];
    }

    if (adminData.deletedProductIds.indexOf(productId) === -1) {
      adminData.deletedProductIds.push(productId);
      adminData.deletedProductIds = normalizeList(adminData.deletedProductIds);
    }
  }

  if (adminData.productOverrides && typeof adminData.productOverrides === 'object') {
    delete adminData.productOverrides[productId];
  }

  if (adminData.priceOverrides && typeof adminData.priceOverrides === 'object') {
    delete adminData.priceOverrides[productId];
  }

  if (adminData.imageOverrides && typeof adminData.imageOverrides === 'object') {
    delete adminData.imageOverrides[productId];
  }

  if (Array.isArray(adminData.categories) && deletedProductNameKey) {
    adminData.categories.forEach(function (category) {
      var categoryKey = normalizeForSearch(category.name);
      if (deletedCategoryKey && categoryKey !== deletedCategoryKey) {
        return;
      }

      if (!Array.isArray(category.items)) {
        return;
      }

      category.items = category.items.filter(function (itemName) {
        return normalizeForSearch(itemName) !== deletedProductNameKey;
      });
    });
  }

  if (!await saveAdminData()) {
    return res.redirect('/admin?error=save-failed');
  }

  return res.redirect('/admin?status=product-deleted');
});

router.post('/admin/categories/delete', async function (req, res) {
  var categoryName = toTrimmedString(req.body.categoryName);
  var catalog = getCatalogContext();
  var categoryBoards = buildAdminCategoryBoards(catalog.categoryGroups, catalog.productSections, catalog.categoryKeywordMap);
  var categoryKey = normalizeForSearch(categoryName);
  var matchedBoard = null;
  var matchedCategoryName = '';
  var matchedCategoryKey = '';
  var deletedProductIdsByKey = Object.create(null);
  var deletedProductIds = [];

  if (!categoryName) {
    return res.redirect('/admin?error=category-name-required');
  }

  matchedBoard = categoryBoards.find(function (board) {
    return normalizeForSearch(board.name) === categoryKey;
  }) || null;

  if (!matchedBoard) {
    return res.redirect('/admin?error=category-not-found');
  }

  matchedCategoryName = matchedBoard.name;
  matchedCategoryKey = normalizeForSearch(matchedCategoryName);

  if (!Array.isArray(adminData.deletedCategoryNames)) {
    adminData.deletedCategoryNames = [];
  }

  if (!isDeletedCategory(matchedCategoryName)) {
    adminData.deletedCategoryNames.push(matchedCategoryName);
    adminData.deletedCategoryNames = normalizeList(adminData.deletedCategoryNames);
  }

  if (Array.isArray(adminData.categories)) {
    adminData.categories = adminData.categories.filter(function (category) {
      return normalizeForSearch(category.name) !== matchedCategoryKey;
    });
  }

  (matchedBoard.items || []).forEach(function (item) {
    if (item && item.id) {
      deletedProductIdsByKey[item.id] = true;
    }
  });

  if (Array.isArray(adminData.products)) {
    adminData.products.forEach(function (product) {
      var productOverride = getProductOverrideEntry(product.id);
      var effectiveCategoryName = toTrimmedString(productOverride.type) || toTrimmedString(product.type);
      if (normalizeForSearch(effectiveCategoryName) === matchedCategoryKey) {
        deletedProductIdsByKey[product.id] = true;
      }
    });
  }

  deletedProductIds = Object.keys(deletedProductIdsByKey);

  if (Array.isArray(adminData.products) && deletedProductIds.length > 0) {
    adminData.products = adminData.products.filter(function (product) {
      return !deletedProductIdsByKey[product.id];
    });
  }

  if (!Array.isArray(adminData.deletedProductIds)) {
    adminData.deletedProductIds = [];
  }

  if (deletedProductIds.length > 0) {
    adminData.deletedProductIds = normalizeList(adminData.deletedProductIds.concat(deletedProductIds));
  }

  if (adminData.productOverrides && typeof adminData.productOverrides === 'object') {
    deletedProductIds.forEach(function (productId) {
      delete adminData.productOverrides[productId];
    });
  }

  if (adminData.priceOverrides && typeof adminData.priceOverrides === 'object') {
    deletedProductIds.forEach(function (productId) {
      delete adminData.priceOverrides[productId];
    });
  }

  if (adminData.imageOverrides && typeof adminData.imageOverrides === 'object') {
    deletedProductIds.forEach(function (productId) {
      delete adminData.imageOverrides[productId];
    });
  }

  if (!await saveAdminData()) {
    return res.redirect('/admin?error=save-failed');
  }

  return res.redirect('/admin?status=category-deleted');
});

router.post('/admin/categories', async function (req, res) {
  var categoryName = toTrimmedString(req.body.categoryName);
  var categoryDescription = toTrimmedString(req.body.categoryDescription);
  var categoryItems = parseCommaSeparatedList(req.body.categoryItems);

  if (!categoryName) {
    return res.redirect('/admin?error=category-name-required');
  }

  upsertAdminCategory(categoryName, categoryDescription, categoryItems);

  if (!await saveAdminData()) {
    return res.redirect('/admin?error=save-failed');
  }

  return res.redirect('/admin?status=category-saved');
});

router.post('/admin/products', function (req, res) {
  imageUpload.single('productImageFile')(req, res, async function (uploadError) {
    if (uploadError) {
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        return res.redirect('/admin?error=image-too-large');
      }

      if (uploadError.message === 'invalid-image-file') {
        return res.redirect('/admin?error=invalid-image-file');
      }

      return res.redirect('/admin?error=save-failed');
    }

    var categoryName = toTrimmedString(req.body.productCategory);
    var productName = toTrimmedString(req.body.productName);
    var productSpec = toTrimmedString(req.body.productSpec) || 'N/A';
    var productPrice = toTrimmedString(req.body.productPrice) || 'Contact for price';
    var uploadedImagePath = getUploadedImagePath(req.file);
    var primaryImage = uploadedImagePath || '';
    var productImages = parseCommaSeparatedList(req.body.productImages)
      .map(function (imagePath) {
        return normalizeAssetPath(imagePath);
      })
      .filter(Boolean);

    if (uploadedImagePath) {
      productImages.unshift(uploadedImagePath);
    }

    if (!categoryName) {
      return res.redirect('/admin?error=product-category-required');
    }

    if (!productName) {
      return res.redirect('/admin?error=product-name-required');
    }

    if (!uploadedImagePath) {
      return res.redirect('/admin?error=product-image-file-required');
    }

    upsertAdminCategory(categoryName, '', [productName]);

    var catalog = getCatalogContext();
    var productId = buildUniqueProductId(categoryName, productName, catalog.productSections);

    if (Array.isArray(adminData.deletedProductIds)) {
      adminData.deletedProductIds = adminData.deletedProductIds.filter(function (id) {
        return id !== productId;
      });
    }

    adminData.products.push({
      id: productId,
      type: categoryName,
      name: productName,
      spec: productSpec,
      price: productPrice,
      image: primaryImage,
      images: normalizeImageList(productImages, primaryImage),
    });

    if (!await saveAdminData()) {
      return res.redirect('/admin?error=save-failed');
    }

    return res.redirect('/admin?status=product-saved');
  });
});

router.get('/products/:productId', function (req, res, next) {
  var productId = typeof req.params.productId === 'string' ? req.params.productId.trim() : '';
  var catalog = getCatalogContext();
  var productMatch = findProductById(productId, catalog.productSections);

  if (!productMatch) {
    return next();
  }

  res.render('product-detail', {
    title: productMatch.item.name + ' | BhutanDevi Trade and Suppliers',
    q: '',
    activeCategory: '',
    product: productMatch.item,
    sectionTitle: productMatch.sectionTitle,
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
});

module.exports = router;
