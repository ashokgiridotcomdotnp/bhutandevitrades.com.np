import fs from 'fs';
import path from 'path';
import multer from 'multer';
import sharp from 'sharp';
import Category from '../models/Category.js';
import Product from '../models/Product.js';
import cloudinaryClient from '../lib/cloudinary.js';
import database from '../lib/db.js';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);




import NodeCache from 'node-cache';

let uploadedProductImagesDirPath = path.join(__dirname, '..', 'public', 'uploads', 'products');
let publicAssetsDirPath = path.join(__dirname, '..', 'public');
let defaultProductImagePath = '';
let homeCarouselImages = [
  '/images/productParts/slidePasal.webp',
  '/images/productParts/slidePasal2.webp',
  '/images/productParts/slidePasal3.webp',
  '/images/productParts/helmet1.webp',
];
let parsedCatalogCacheTtlMs = Number(process.env.CATALOG_CACHE_TTL_MS);
let catalogCacheTtlMs = Number.isFinite(parsedCatalogCacheTtlMs) && parsedCatalogCacheTtlMs >= 0
  ? parsedCatalogCacheTtlMs
  : 15000;
const catalogCache = new NodeCache({ stdTTL: catalogCacheTtlMs / 1000 }); // TTL in seconds

let cloudinaryUploadFolder = String(process.env.CLOUDINARY_PRODUCT_UPLOAD_FOLDER || 'bhutandevi/products').trim()
  || 'bhutandevi/products';
let parsedCloudinaryUploadTimeoutMs = Number(process.env.CLOUDINARY_UPLOAD_TIMEOUT_MS);
let cloudinaryUploadTimeoutMs = Number.isFinite(parsedCloudinaryUploadTimeoutMs) && parsedCloudinaryUploadTimeoutMs >= 0
  ? Math.floor(parsedCloudinaryUploadTimeoutMs)
  : 3500;
let catalogCategorySelectFields = 'name normalizedName slug description items sortOrder isActive';
let catalogProductSelectFields = 'legacyId category name spec description price compareAtPrice quantity imageUrl images createdAt status isActive';

function ensureDirectoryExists(directoryPath) {
  if (!fs.existsSync(directoryPath)) {
    fs.mkdirSync(directoryPath, { recursive: true });
  }
}

ensureDirectoryExists(uploadedProductImagesDirPath);

let imageUploadStorage = multer.diskStorage({
  destination: function (req, file, callback) {
    callback(null, uploadedProductImagesDirPath);
  },
  filename: function (req, file, callback) {
    let baseName = path
      .basename(file && file.originalname ? file.originalname : 'image')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    let uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);

    // Never trust the original extension. The uploaded file is temporarily stored in a public
    // directory, so forcing a non-executable extension avoids serving attacker-controlled JS/HTML.
    callback(null, (baseName || 'image') + '-' + uniqueSuffix + '.upload');
  },
});

let allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp'];
let maxFileSize = 5 * 1024 * 1024;

let imageUpload = multer({
  storage: imageUploadStorage,
  limits: {
    fileSize: maxFileSize,
    files: 1,
  },
  fileFilter: function (req, file, callback) {
    let originalName = String(file && file.originalname ? file.originalname : '');

    if (!file || !file.mimetype) {
      return callback(new Error('invalid-image-file'));
    }

    if (allowedImageTypes.indexOf(file.mimetype) === -1) {
      return callback(new Error('invalid-image-type'));
    }

    if (originalName.indexOf('..') !== -1 || originalName.indexOf('/') !== -1 || originalName.indexOf('\\') !== -1) {
      return callback(new Error('invalid-filename'));
    }

    callback(null, true);
  },
});

function toTrimmedString(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }

  return String(value).trim();
}

function normalizeForSearch(value) {
  return toTrimmedString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeList(values) {
  let list = Array.isArray(values) ? values : [];
  let seen = Object.create(null);
  let normalizedValues = [];

  list.forEach(function (value) {
    let trimmed = toTrimmedString(value);
    let key = normalizeForSearch(trimmed);

    if (!trimmed || !key || seen[key]) {
      return;
    }

    seen[key] = true;
    normalizedValues.push(trimmed);
  });

  return normalizedValues;
}

function parseCommaSeparatedList(value) {
  return normalizeList(String(value || '').split(/[,\n]+/));
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatNprAmount(value) {
  let numericValue = Number(value);
  let hasDecimals = false;

  if (!Number.isFinite(numericValue) || numericValue < 0) {
    return '';
  }

  hasDecimals = Math.abs(numericValue % 1) > 0;

  return 'NPR ' + numericValue.toLocaleString('en-US', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function slugify(value) {
  return toTrimmedString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeAssetPath(value) {
  let trimmed = toTrimmedString(value);
  let normalizedValue = '';

  if (!trimmed) {
    return '';
  }

  normalizedValue = trimmed
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\\/g, '/');

  if (!normalizedValue) {
    return '';
  }

  if (/^https?:\/[^/]/i.test(normalizedValue)) {
    normalizedValue = normalizedValue.replace(/^https?:\/(?!\/)/i, function (protocolPrefix) {
      return /^https:/i.test(protocolPrefix) ? 'https://' : 'http://';
    });
  }

  if (normalizedValue.indexOf('//') === 0) {
    return 'https:' + normalizedValue;
  }

  if (/^res\.cloudinary\.com\//i.test(normalizedValue)) {
    return 'https://' + normalizedValue;
  }

  if (/^https?:\/\//i.test(normalizedValue)) {
    if (/^http:\/\/res\.cloudinary\.com\//i.test(normalizedValue)) {
      return normalizedValue.replace(/^http:\/\//i, 'https://');
    }

    return normalizedValue;
  }

  if (normalizedValue.charAt(0) === '.') {
    normalizedValue = normalizedValue.replace(/^\.+/, '');
  }

  if (normalizedValue.charAt(0) !== '/') {
    normalizedValue = '/' + normalizedValue.replace(/^\/+/, '');
  }

  if (normalizedValue.indexOf('..') !== -1) {
    return '';
  }

  return normalizedValue;
}

function getPublicFilePathFromAssetPath(assetPath) {
  let normalizedPath = normalizeAssetPath(assetPath);
  let cleanPath = '';
  let decodedPath = '';
  let relativePath = '';
  let resolvedPath = '';

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

function getUploadedImagePath(file) {
  if (!file || !file.filename) {
    return '';
  }

  return '/uploads/products/' + file.filename;
}

function normalizeImageList(images, fallbackImage) {
  let imageList = normalizeList((images || []).map(function (imagePath) {
    return normalizeAssetPath(imagePath);
  }).filter(Boolean));
  let primaryImage = normalizeAssetPath(fallbackImage);

  if (primaryImage) {
    imageList.unshift(primaryImage);
  }

  return normalizeList(imageList);
}

async function deleteFileSafely(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    await fs.promises.unlink(filePath);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return false;
    }

    console.error('Failed to remove temporary upload file:', error.message);
    return false;
  }
}

async function optimizeUploadedImage(file) {
  let sourceFilePath = file && file.path ? file.path : '';
  let uploadedImagePath = getUploadedImagePath(file);
  let sourcePathParts = null;
  let optimizedBaseName = '';
  let optimizedFilePath = '';

  if (!sourceFilePath || !uploadedImagePath) {
    return '';
  }

  sourcePathParts = path.parse(sourceFilePath);
  optimizedBaseName = sourcePathParts.name + '-opt.webp';
  optimizedFilePath = path.join(sourcePathParts.dir, optimizedBaseName);

  try {
    await sharp(sourceFilePath)
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({
        quality: 82,
        effort: 4,
      })
      .toFile(optimizedFilePath);

    if (optimizedFilePath !== sourceFilePath) {
      await deleteFileSafely(sourceFilePath);
    }

    return '/uploads/products/' + optimizedBaseName;
  } catch (error) {
    console.error('Failed to optimize uploaded image:', error.message);
    await deleteFileSafely(sourceFilePath);
    return '';
  }
}

function isCloudinaryUrl(assetPath) {
  return /^https?:\/\/res\.cloudinary\.com\//i.test(normalizeAssetPath(assetPath));
}

async function uploadImageSourceToCloudinary(sourcePath, fallbackPath) {
  let uploadResult = null;
  let secureUrl = '';
  let uploadUrl = '';

  try {
    uploadResult = await cloudinaryClient.cloudinary.uploader.upload(sourcePath, {
      folder: cloudinaryUploadFolder,
      resource_type: 'image',
      format: 'webp',
      transformation: [
        {
          width: 1600,
          height: 1600,
          crop: 'limit',
          quality: 'auto:good',
        },
      ],
    });
    secureUrl = uploadResult && uploadResult.secure_url ? String(uploadResult.secure_url).trim() : '';
    uploadUrl = uploadResult && uploadResult.url ? String(uploadResult.url).trim() : '';

    if (secureUrl) {
      return normalizeAssetPath(secureUrl);
    }

    if (uploadUrl) {
      return normalizeAssetPath(uploadUrl);
    }

    return normalizeAssetPath(fallbackPath);
  } catch (error) {
    console.error('Failed to upload image to Cloudinary:', error.message);
    return normalizeAssetPath(fallbackPath);
  }
}

async function uploadImageSourceToCloudinaryWithTimeout(sourcePath, fallbackPath, timeoutMs) {
  let safeFallbackPath = normalizeAssetPath(fallbackPath);
  let uploadPromise = uploadImageSourceToCloudinary(sourcePath, safeFallbackPath).catch(function () {
    return safeFallbackPath;
  });

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return uploadPromise;
  }

  return Promise.race([
    uploadPromise,
    new Promise(function (resolve) {
      setTimeout(function () {
        resolve(safeFallbackPath);
      }, timeoutMs);
    }),
  ]);
}

async function promoteImageToCloudinary(assetPath) {
  let normalizedAssetPath = normalizeAssetPath(assetPath);
  let localFilePath = '';

  if (!normalizedAssetPath || isCloudinaryUrl(normalizedAssetPath)) {
    return normalizedAssetPath;
  }

  if (!cloudinaryClient.isCloudinaryConfigured()) {
    return normalizedAssetPath;
  }

  if (/^https?:\/\//i.test(normalizedAssetPath)) {
    return uploadImageSourceToCloudinary(normalizedAssetPath, normalizedAssetPath);
  }

  localFilePath = getPublicFilePathFromAssetPath(normalizedAssetPath);
  if (!localFilePath || !fs.existsSync(localFilePath)) {
    return normalizedAssetPath;
  }

  return uploadImageSourceToCloudinary(localFilePath, normalizedAssetPath);
}

async function optimizeAndPromoteUploadedImage(file) {
  let localImagePath = normalizeAssetPath(await optimizeUploadedImage(file));
  let localFilePath = '';
  let cloudImagePath = '';

  if (!localImagePath) {
    return '';
  }

  if (/^https?:\/\//i.test(localImagePath)) {
    return localImagePath;
  }

  localFilePath = getPublicFilePathFromAssetPath(localImagePath);
  if (!localFilePath || !fs.existsSync(localFilePath)) {
    return localImagePath;
  }

  if (!cloudinaryClient.isCloudinaryConfigured()) {
    return localImagePath;
  }

  cloudImagePath = normalizeAssetPath(await uploadImageSourceToCloudinaryWithTimeout(
    localFilePath,
    localImagePath,
    cloudinaryUploadTimeoutMs
  ));

  if (isCloudinaryUrl(cloudImagePath)) {
    await cleanupLocalImageAsset(localImagePath);
    return cloudImagePath;
  }

  return localImagePath;
}

async function cleanupLocalImageAsset(assetPath) {
  let normalizedAssetPath = normalizeAssetPath(assetPath);
  let localFilePath = '';

  if (!normalizedAssetPath || /^https?:\/\//i.test(normalizedAssetPath)) {
    return;
  }

  localFilePath = getPublicFilePathFromAssetPath(normalizedAssetPath);
  if (!localFilePath) {
    return;
  }

  await deleteFileSafely(localFilePath);
}

function clearCatalogContextCache() {
  catalogCache.flushAll();
}

function createEmptyCatalogContext() {
  return {
    categoryGroups: [],
    productSections: [],
    categoryKeywordMap: {},
  };
}

function computeDiscountPercent(price, compareAtPrice) {
  let numericPrice = Number(price);
  let numericCompareAtPrice = Number(compareAtPrice);
  let percentage = 0;

  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    return '';
  }

  if (!Number.isFinite(numericCompareAtPrice) || numericCompareAtPrice <= numericPrice) {
    return '';
  }

  percentage = ((numericCompareAtPrice - numericPrice) / numericCompareAtPrice) * 100;
  return String(Math.round(percentage * 100) / 100).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1');
}

function buildCategoryKeywordMap(categoryGroups) {
  let keywordMap = {};

  (categoryGroups || []).forEach(function (group) {
    let groupKey = normalizeForSearch(group && group.name);

    if (!groupKey) {
      return;
    }

    keywordMap[groupKey] = normalizeList([group.name].concat(group.items || []));
  });

  return keywordMap;
}

function toCatalogProduct(productDoc, addedOrder) {
  let categoryDoc = productDoc && productDoc.category && typeof productDoc.category === 'object'
    ? productDoc.category
    : null;
  let effectiveCategoryName = toTrimmedString(categoryDoc && categoryDoc.name);
  let quantity = Number(productDoc && productDoc.quantity);
  let price = Number(productDoc && productDoc.price);
  let rawCompareAtPrice = productDoc && typeof productDoc === 'object'
    ? productDoc.compareAtPrice
    : null;
  let compareAtPrice = rawCompareAtPrice === null || typeof rawCompareAtPrice === 'undefined' || rawCompareAtPrice === ''
    ? NaN
    : Number(rawCompareAtPrice);
  let primaryImage = normalizeAssetPath(
    productDoc && productDoc.imageUrl
    || (Array.isArray(productDoc && productDoc.images) ? productDoc.images[0] : '')
  );
  let safeImages = normalizeImageList(productDoc && productDoc.images, primaryImage);
  let productId = toTrimmedString(productDoc && productDoc.legacyId)
    || toTrimmedString(productDoc && productDoc._id);

  return {
    id: productId,
    mongoId: toTrimmedString(productDoc && productDoc._id),
    type: effectiveCategoryName || 'Category',
    name: toTrimmedString(productDoc && productDoc.name) || 'Product',
    spec: toTrimmedString(productDoc && (productDoc.spec || productDoc.description)),
    price: Number.isFinite(price) ? formatNprAmount(price) : 'Contact for price',
    priceValue: Number.isFinite(price) ? price : null,
    compareAtPrice: Number.isFinite(compareAtPrice) ? compareAtPrice : null,
    originalPrice: Number.isFinite(compareAtPrice) && compareAtPrice > price ? formatNprAmount(compareAtPrice) : '',
    discountPercent: computeDiscountPercent(price, compareAtPrice),
    quantity: Number.isFinite(quantity) && quantity >= 0 ? quantity : 0,
    image: primaryImage || defaultProductImagePath,
    images: safeImages,
    addedOrder: Number.isFinite(Number(addedOrder)) ? Number(addedOrder) : 0,
  };
}

function buildCatalogContext(categoryDocs, productDocs) {
  let normalizedCategoryDocs = Array.isArray(categoryDocs) ? categoryDocs : [];
  let normalizedProductDocs = Array.isArray(productDocs) ? productDocs : [];
  let categoryGroups = [];
  let categoryGroupsByKey = Object.create(null);
  let sectionByKey = Object.create(null);
  let productSections = [];
  let categoryKeywordMap = {};
  let seenCategoryProductNames = Object.create(null);
  let sectionTitle = '';
  let sectionKey = '';

  normalizedCategoryDocs.forEach(function (categoryDoc) {
    let categoryName = toTrimmedString(categoryDoc && categoryDoc.name);
    let categoryKey = normalizeForSearch(categoryName);

    if (!categoryName || !categoryKey || categoryGroupsByKey[categoryKey]) {
      return;
    }

    categoryGroupsByKey[categoryKey] = {
      name: categoryName,
      description: toTrimmedString(categoryDoc && categoryDoc.description),
      items: normalizeList(categoryDoc && categoryDoc.items),
    };

    categoryGroups.push(categoryGroupsByKey[categoryKey]);
  });

  normalizedProductDocs.forEach(function (productDoc, index) {
    let categoryDoc = productDoc && productDoc.category && typeof productDoc.category === 'object'
      ? productDoc.category
      : null;
    let categoryName = toTrimmedString(categoryDoc && categoryDoc.name);
    let categoryKey = normalizeForSearch(categoryName);
    let productName = toTrimmedString(productDoc && productDoc.name);
    let categoryProductKey = categoryKey + '::' + normalizeForSearch(productName);
    let section = null;

    if (!categoryName || !categoryKey || !productName) {
      return;
    }

    if (seenCategoryProductNames[categoryProductKey]) {
      return;
    }

    seenCategoryProductNames[categoryProductKey] = true;

    if (!categoryGroupsByKey[categoryKey]) {
      categoryGroupsByKey[categoryKey] = {
        name: categoryName,
        description: '',
        items: [],
      };
      categoryGroups.push(categoryGroupsByKey[categoryKey]);
    }

    if (categoryGroupsByKey[categoryKey].items.indexOf(productName) === -1) {
      categoryGroupsByKey[categoryKey].items.push(productName);
    }

    section = sectionByKey[categoryKey];
    if (!section) {
      section = {
        title: categoryName,
        subtitle: '',
        items: [],
      };
      sectionByKey[categoryKey] = section;
      productSections.push(section);
    }

    section.items.push(toCatalogProduct(productDoc, normalizedProductDocs.length - index));
  });

  productSections.forEach(function (section) {
    section.items.sort(function (left, right) {
      return (
        (Number(right && right.addedOrder) - Number(left && left.addedOrder)) ||
        String(left && left.name ? left.name : '').localeCompare(String(right && right.name ? right.name : ''))
      );
    });
  });

  categoryGroups.sort(function (left, right) {
    return String(left && left.name ? left.name : '').localeCompare(String(right && right.name ? right.name : ''));
  });
  categoryGroups.forEach(function (group) {
    group.items = normalizeList(group.items).sort(function (left, right) {
      return left.localeCompare(right);
    });
  });

  productSections.sort(function (left, right) {
    sectionTitle = toTrimmedString(left && left.title);
    sectionKey = toTrimmedString(right && right.title);
    return sectionTitle.localeCompare(sectionKey);
  });

  categoryKeywordMap = buildCategoryKeywordMap(categoryGroups);

  return {
    categoryGroups: categoryGroups,
    productSections: productSections,
    categoryKeywordMap: categoryKeywordMap,
  };
}

async function getCatalogContext(options) {
  const cacheKey = 'catalog-context';
  let forceRefresh = Boolean(options && options.forceRefresh);

  if (!forceRefresh) {
    const cachedContext = catalogCache.get(cacheKey);
    if (cachedContext) {
      return cloneValue(cachedContext);
    }
  }

  try {
    const hasDatabaseConnection = await database.connectToDatabase();
    if (!hasDatabaseConnection) {
      clearCatalogContextCache();
      return createEmptyCatalogContext();
    }

    const [categoryDocs, productDocs] = await Promise.all([
      Category.find({ isActive: true })
        .select(catalogCategorySelectFields)
        .sort({ sortOrder: 1, name: 1 })
        .lean(),
      Product.find({ isActive: true, status: 'active' })
        .select(catalogProductSelectFields)
        .populate({
          path: 'category',
          select: catalogCategorySelectFields,
          options: { lean: true },
        })
        .sort({ createdAt: -1, name: 1 })
        .lean(),
    ]);

    const catalogContext = buildCatalogContext(
      Array.isArray(categoryDocs) ? categoryDocs : [],
      Array.isArray(productDocs) ? productDocs : []
    );

    catalogCache.set(cacheKey, catalogContext);
    return cloneValue(catalogContext);
  } catch (error) {
    console.error('Failed to load catalog context:', error.message);
    clearCatalogContextCache();
    return createEmptyCatalogContext();
  }
}

function resolveCategoryName(rawCategory, categoryGroups) {
  let normalizedCategory = normalizeForSearch(String(rawCategory || '').replace(/-/g, ' '));
  let matchedGroup = null;

  if (!normalizedCategory) {
    return '';
  }

  matchedGroup = (categoryGroups || []).find(function (group) {
    return normalizeForSearch(group && group.name) === normalizedCategory;
  }) || null;

  return matchedGroup ? matchedGroup.name : '';
}

function includesQuery(value, query) {
  let normalizedValue = normalizeForSearch(value);
  let normalizedQuery = normalizeForSearch(query);
  let queryTerms = normalizedQuery ? normalizedQuery.split(' ') : [];

  if (!queryTerms.length) {
    return true;
  }

  return queryTerms.every(function (term) {
    return normalizedValue.indexOf(term) !== -1;
  });
}

function buildCategoryViewData(query, selectedCategory, categoryGroups) {
  let normalizedSelectedCategory = normalizeForSearch(selectedCategory);
  let normalizedQuery = normalizeForSearch(query);

  return (categoryGroups || []).map(function (group) {
    let groupName = toTrimmedString(group && group.name);
    let groupItems = normalizeList(group && group.items);
    let normalizedGroupName = normalizeForSearch(groupName);
    let isSelectedCategory = normalizedSelectedCategory && normalizedSelectedCategory === normalizedGroupName;
    let matchedItems = groupItems.map(function (itemLabel) {
      return {
        label: itemLabel,
        isMatch: normalizedQuery ? includesQuery(itemLabel, normalizedQuery) : false,
      };
    });
    let hasMatchedItems = matchedItems.some(function (item) {
      return Boolean(item.isMatch);
    });

    return {
      name: groupName,
      description: toTrimmedString(group && group.description),
      items: matchedItems,
      isActive: Boolean(isSelectedCategory || (!normalizedSelectedCategory && normalizedQuery && hasMatchedItems)),
    };
  });
}

function filterProductData(query, selectedCategory, productSections) {
  let normalizedSelectedCategory = normalizeForSearch(selectedCategory);
  let normalizedQuery = normalizeForSearch(query);

  return (productSections || []).map(function (section) {
    let sectionTitle = toTrimmedString(section && section.title);
    let sectionKey = normalizeForSearch(sectionTitle);
    let filteredItems = (section && section.items || []).filter(function (item) {
      let itemSearchableText = [
        item && item.type,
        item && item.name,
        item && item.spec,
      ].join(' ');

      if (normalizedSelectedCategory && normalizedSelectedCategory !== sectionKey) {
        return false;
      }

      if (normalizedQuery && !includesQuery(itemSearchableText, normalizedQuery)) {
        return false;
      }

      return true;
    });

    return {
      title: sectionTitle,
      subtitle: toTrimmedString(section && section.subtitle),
      items: filteredItems,
    };
  }).filter(function (section) {
    return Array.isArray(section.items) && section.items.length > 0;
  });
}

function getOpenCategoryName(groups, selectedCategory, query) {
  let normalizedSelectedCategory = normalizeForSearch(selectedCategory);
  let normalizedQuery = normalizeForSearch(query);
  let activeGroup = null;

  if (normalizedSelectedCategory) {
    return selectedCategory;
  }

  if (!normalizedQuery) {
    return '';
  }

  activeGroup = (groups || []).find(function (group) {
    return Boolean(group && group.isActive);
  }) || null;

  return activeGroup ? toTrimmedString(activeGroup.name) : '';
}

function countItems(sections) {
  return (sections || []).reduce(function (total, section) {
    return total + (Array.isArray(section && section.items) ? section.items.length : 0);
  }, 0);
}

function findProductById(productId, productSections) {
  let normalizedProductId = toTrimmedString(productId);
  let matchedResult = null;

  if (!normalizedProductId) {
    return null;
  }

  (productSections || []).some(function (section, sectionIndex) {
    let sectionItems = Array.isArray(section && section.items) ? section.items : [];

    return sectionItems.some(function (item, itemIndex) {
      if (toTrimmedString(item && item.id) !== normalizedProductId && toTrimmedString(item && item.mongoId) !== normalizedProductId) {
        return false;
      }

      matchedResult = {
        sectionIndex: sectionIndex,
        itemIndex: itemIndex,
        sectionTitle: toTrimmedString(section && section.title),
        item: item,
      };
      return true;
    });
  });

  return matchedResult;
}

function buildSearchSuggestions(categoryGroups, productSections) {
  let suggestions = [];

  (categoryGroups || []).forEach(function (group) {
    suggestions.push(group && group.name);
    suggestions = suggestions.concat(group && group.items || []);
  });

  (productSections || []).forEach(function (section) {
    (section && section.items || []).forEach(function (item) {
      suggestions.push(item && item.name);
      suggestions.push(item && item.spec);
    });
  });

  return normalizeList(suggestions).slice(0, 50);
}

function buildUniqueProductId(categoryName, productName, productSections) {
  let baseId = slugify([categoryName, productName].join(' '));
  let safeBaseId = baseId || slugify(productName) || 'product';
  let candidateId = safeBaseId;
  let counter = 2;

  while (findProductById(candidateId, productSections)) {
    candidateId = safeBaseId + '-' + counter;
    counter += 1;
  }

  return candidateId;
}

async function buildUniqueProductLegacyId(categoryName, productName) {
  let baseId = slugify([categoryName, productName].join(' '));
  let safeBaseId = baseId || slugify(productName) || 'product';
  let candidateId = safeBaseId;
  let counter = 2;
  let productExists = false;

  if (!await database.connectToDatabase()) {
    return safeBaseId;
  }

  do {
    productExists = Boolean(await Product.exists({ legacyId: candidateId }));

    if (!productExists) {
      return candidateId;
    }

    candidateId = safeBaseId + '-' + counter;
    counter += 1;
  } while (counter < 10000);

  return safeBaseId + '-' + Date.now().toString(36);
}

async function queryProductDocumentByIdentifier(productId, options) {
  let normalizedProductId = toTrimmedString(productId);
  let filters = [];
  let query = {};

  if (!normalizedProductId) {
    return null;
  }

  if (/^[a-f0-9]{24}$/i.test(normalizedProductId)) {
    filters.push({ _id: normalizedProductId });
  }

  filters.push({ legacyId: normalizedProductId });

  if (!await database.connectToDatabase()) {
    return null;
  }

  query.$or = filters;

  if (options && options.activeOnly) {
    query.isActive = true;
    query.status = 'active';
  }

  return Product.findOne(query)
    .select(catalogProductSelectFields)
    .populate({
      path: 'category',
      select: catalogCategorySelectFields,
      options: { lean: true },
    })
    .lean();
}

async function findProductDocumentByIdentifier(productId, options) {
  return queryProductDocumentByIdentifier(productId, options);
}

async function getCatalogProductByIdentifier(productId, options) {
  let productDoc = await queryProductDocumentByIdentifier(productId, options);
  let createdAt = productDoc && productDoc.createdAt ? new Date(productDoc.createdAt).getTime() : 0;

  if (!productDoc) {
    return null;
  }

  return toCatalogProduct(productDoc, createdAt);
}

function buildAdminCategoryBoards(categoryGroups, productSections) {
  let sectionByKey = Object.create(null);
  let boards = [];

  (productSections || []).forEach(function (section) {
    let sectionKey = normalizeForSearch(section && section.title);

    if (!sectionKey) {
      return;
    }

    sectionByKey[sectionKey] = {
      title: toTrimmedString(section && section.title),
      subtitle: toTrimmedString(section && section.subtitle),
      items: cloneValue(section && section.items || []),
    };
  });

  (categoryGroups || []).forEach(function (group) {
    let groupName = toTrimmedString(group && group.name);
    let groupKey = normalizeForSearch(groupName);
    let section = sectionByKey[groupKey];

    boards.push({
      name: groupName,
      description: toTrimmedString(group && group.description),
      items: section ? section.items : [],
    });

    delete sectionByKey[groupKey];
  });

  Object.keys(sectionByKey).forEach(function (sectionKey) {
    let section = sectionByKey[sectionKey];

    boards.push({
      name: toTrimmedString(section && section.title),
      description: '',
      items: cloneValue(section && section.items || []),
    });
  });

  boards.sort(function (left, right) {
    return String(left && left.name ? left.name : '').localeCompare(String(right && right.name ? right.name : ''));
  });

  return boards;
}

function getAdminStatusMessage(statusCode) {
  if (statusCode === 'product-saved') {
    return 'Product saved successfully.';
  }

  if (statusCode === 'product-updated') {
    return 'Product updated successfully.';
  }

  if (statusCode === 'product-deleted') {
    return 'Product deleted successfully.';
  }

  if (statusCode === 'category-saved') {
    return 'Category saved successfully.';
  }

  if (statusCode === 'category-deleted') {
    return 'Category deleted successfully.';
  }

  if (statusCode === 'price-saved') {
    return 'Product price saved successfully.';
  }

  if (statusCode === 'image-saved') {
    return 'Product image saved successfully.';
  }

  if (statusCode === 'order-accepted') {
    return 'Order accepted successfully.';
  }

  if (statusCode === 'order-deleted') {
    return 'Order deleted successfully.';
  }

  return '';
}

function getAdminErrorMessage(errorCode) {
  if (errorCode === 'image-too-large') {
    return 'Image file is too large.';
  }

  if (errorCode === 'invalid-image-file' || errorCode === 'invalid-image-type') {
    return 'Please upload a valid image file.';
  }

  if (errorCode === 'product-image-file-required') {
    return 'Image file is required.';
  }

  if (errorCode === 'product-image-required') {
    return 'Image path is required.';
  }

  if (errorCode === 'cloudinary-upload-failed') {
    return 'Image upload to Cloudinary failed. Please try again.';
  }

  if (errorCode === 'product-id-required') {
    return 'Product ID is required.';
  }

  if (errorCode === 'order-id-required') {
    return 'Order ID is required.';
  }

  if (errorCode === 'product-price-required') {
    return 'Price is required.';
  }

  if (errorCode === 'out-of-stock') {
    return 'This product is out of stock and cannot be accepted.';
  }

  if (errorCode === 'insufficient-stock') {
    return 'Not enough stock to accept this order.';
  }

  if (errorCode === 'product-not-found') {
    return 'Product was not found.';
  }

  if (errorCode === 'order-not-found') {
    return 'Order was not found.';
  }

  if (errorCode === 'order-accepted-email-failed') {
    return 'Order accepted, but customer email notification could not be sent.';
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
    return 'Could not save data. Please try again.';
  }

  if (errorCode === 'db-unavailable') {
    return 'Database is unavailable. Please try again later.';
  }

  if (errorCode === 'invalid-input') {
    return 'Input is invalid. Please review your values and try again.';
  }

  if (errorCode === 'duplicate-product') {
    return 'A product with the same category and name already exists.';
  }

  if (errorCode === 'duplicate-category') {
    return 'A category with the same name already exists.';
  }

  return '';
}
export default {
  buildAdminCategoryBoards: buildAdminCategoryBoards,
  buildCategoryViewData: buildCategoryViewData,
  buildSearchSuggestions: buildSearchSuggestions,
  buildUniqueProductLegacyId: buildUniqueProductLegacyId,
  buildUniqueProductId: buildUniqueProductId,
  cleanupLocalImageAsset: cleanupLocalImageAsset,
  clearCatalogContextCache: clearCatalogContextCache,
  countItems: countItems,
  defaultProductImagePath: defaultProductImagePath,
  filterProductData: filterProductData,
  findProductById: findProductById,
  getCatalogProductByIdentifier: getCatalogProductByIdentifier,
  findProductDocumentByIdentifier: findProductDocumentByIdentifier,
  formatNprAmount: formatNprAmount,
  getAdminErrorMessage: getAdminErrorMessage,
  getAdminStatusMessage: getAdminStatusMessage,
  getCatalogContext: getCatalogContext,
  getOpenCategoryName: getOpenCategoryName,
  getUploadedImagePath: getUploadedImagePath,
  homeCarouselImages: homeCarouselImages,
  imageUpload: imageUpload,
  normalizeAssetPath: normalizeAssetPath,
  normalizeForSearch: normalizeForSearch,
  normalizeImageList: normalizeImageList,
  normalizeList: normalizeList,
  optimizeAndPromoteUploadedImage: optimizeAndPromoteUploadedImage,
  optimizeUploadedImage: optimizeUploadedImage,
  parseCommaSeparatedList: parseCommaSeparatedList,
  promoteImageToCloudinary: promoteImageToCloudinary,
  resolveCategoryName: resolveCategoryName,
  toTrimmedString: toTrimmedString,
};
