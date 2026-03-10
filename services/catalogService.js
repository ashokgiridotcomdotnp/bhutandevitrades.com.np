var fs = require('fs');
var path = require('path');
var multer = require('multer');
var sharp = require('sharp');
var adminDataStore = require('../repositories/adminDataStore');
var cloudinaryClient = require('../lib/cloudinary');

var uploadedProductImagesDirPath = path.join(__dirname, '..', 'public', 'uploads', 'products');
var publicAssetsDirPath = path.join(__dirname, '..', 'public');
var defaultProductImagePath = '';
var baseCategoryGroups = [];
var baseProductSections = [];
var baseCategoryKeywordMap = {};
var homeCarouselImages = [
  '/images/productParts/slidePasal.webp',
  '/images/productParts/slidePasal2.webp',
  '/images/productParts/slidePasal3.webp',
  '/images/productParts/helmet1.webp',
];
var hasAttemptedDatabaseBootstrap = false;
var parsedCatalogCacheTtlMs = Number(process.env.CATALOG_CACHE_TTL_MS);
var catalogCacheTtlMs = Number.isFinite(parsedCatalogCacheTtlMs) && parsedCatalogCacheTtlMs >= 0 ? parsedCatalogCacheTtlMs : 15000;
var cloudinaryUploadFolder = String(process.env.CLOUDINARY_PRODUCT_UPLOAD_FOLDER || 'bhutandevi/products').trim() || 'bhutandevi/products';
var parsedCloudinaryMigrationCooldownMs = Number(process.env.CLOUDINARY_IMAGE_MIGRATION_COOLDOWN_MS);
var cloudinaryImageMigrationCooldownMs = Number.isFinite(parsedCloudinaryMigrationCooldownMs) && parsedCloudinaryMigrationCooldownMs >= 0
  ? Math.floor(parsedCloudinaryMigrationCooldownMs)
  : 60000;
var parsedCloudinaryUploadTimeoutMs = Number(process.env.CLOUDINARY_UPLOAD_TIMEOUT_MS);
var cloudinaryUploadTimeoutMs = Number.isFinite(parsedCloudinaryUploadTimeoutMs) && parsedCloudinaryUploadTimeoutMs >= 0
  ? Math.floor(parsedCloudinaryUploadTimeoutMs)
  : 3500;
var parsedImageAssetCheckCacheTtlMs = Number(process.env.IMAGE_ASSET_CHECK_CACHE_TTL_MS);
var imageAssetCheckCacheTtlMs = Number.isFinite(parsedImageAssetCheckCacheTtlMs) && parsedImageAssetCheckCacheTtlMs >= 0
  ? Math.floor(parsedImageAssetCheckCacheTtlMs)
  : 60000;
var cachedCatalogContext = null;
var cachedCatalogContextExpiresAt = 0;
var isCloudinaryMigrationInProgress = false;
var lastCloudinaryImageMigrationAt = 0;
var imageAssetExistenceCache = Object.create(null);

function isMongoStorageEnabled() {
  return String(process.env.MONGODB_URI || '').trim().length > 0;
}

function clearCatalogContextCache() {
  cachedCatalogContext = null;
  cachedCatalogContextExpiresAt = 0;
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

var allowedImageTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
var maxFileSize = 5 * 1024 * 1024; // 5MB

var imageUpload = multer({
  storage: imageUploadStorage,
  limits: {
    fileSize: maxFileSize,
    files: 1,
  },
  fileFilter: function (req, file, callback) {
    // Check mimetype
    if (!file || !file.mimetype) {
      return callback(new Error('invalid-image-file'));
    }

    if (!allowedImageTypes.includes(file.mimetype)) {
      return callback(new Error('invalid-image-type'));
    }

    // Validate filename to prevent path traversal
    var originalName = String(file.originalname || '');
    if (originalName.indexOf('..') !== -1 || originalName.indexOf('/') !== -1 || originalName.indexOf('\\') !== -1) {
      return callback(new Error('invalid-filename'));
    }

    callback(null, true);
  },
});

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

function getHelmetCoverageType(item) {
  var categoryKey = normalizeForSearch(item && item.type);
  var searchableText = normalizeForSearch([
    item && item.name,
    item && item.spec,
  ].join(' '));

  if (categoryKey !== 'helmet' || !searchableText) {
    return '';
  }

  if (
    searchableText.indexOf('type full') !== -1 ||
    searchableText.indexOf('full face') !== -1 ||
    searchableText.indexOf('full helmet') !== -1
  ) {
    return 'full';
  }

  if (
    searchableText.indexOf('type half') !== -1 ||
    searchableText.indexOf('half face') !== -1 ||
    searchableText.indexOf('half helmet') !== -1 ||
    searchableText.indexOf('open face') !== -1
  ) {
    return 'half';
  }

  return '';
}

function getHelmetCoverageLabel(item) {
  var coverageType = getHelmetCoverageType(item);

  if (coverageType === 'full') {
    return 'Full Face Helmets';
  }

  if (coverageType === 'half') {
    return 'Half Face Helmets';
  }

  return '';
}

function getHelmetCoverageSearchKeywords(item) {
  var coverageType = getHelmetCoverageType(item);

  if (coverageType === 'full') {
    return ['full helmet', 'full helmets', 'full face helmet', 'full face helmets'];
  }

  if (coverageType === 'half') {
    return ['half helmet', 'half helmets', 'half face helmet', 'half face helmets', 'open face helmet', 'open face helmets'];
  }

  return [];
}

function buildProductSearchableText(item, section) {
  var baseText = [
    section && section.title,
    section && section.subtitle,
    item && item.type,
    item && item.name,
    item && item.spec,
  ].join(' ');
  var coverageKeywords = getHelmetCoverageSearchKeywords(item);

  if (!coverageKeywords.length) {
    return baseText;
  }

  return [baseText].concat(coverageKeywords).join(' ');
}

function toTrimmedString(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }

  return String(value).trim();
}

function normalizeOptionalDescription(value) {
  var cleanedValue = toTrimmedString(value);

  if (!cleanedValue) {
    return '';
  }

  if (/^n\/?a$/i.test(cleanedValue) || /^not available$/i.test(cleanedValue)) {
    return '';
  }

  return cleanedValue;
}

function parseCommaSeparatedList(value) {
  return normalizeList(String(value || '').split(/[,\n]+/));
}

function normalizeAssetPath(value) {
  var trimmed = toTrimmedString(value);
  var normalizedValue = '';

  if (!trimmed) {
    return '';
  }

  normalizedValue = trimmed
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/\\/g, '/');

  if (!normalizedValue) {
    return '';
  }

  if (normalizedValue.indexOf('/images/helmets/') === 0) {
    normalizedValue = normalizedValue.replace('/images/helmets/', '/images/productParts/');
  }

  // Accept malformed schemes like `https:/example.com/...`.
  if (/^https?:\/[^/]/i.test(normalizedValue)) {
    normalizedValue = normalizedValue.replace(/^https?:\/(?!\/)/i, function (protocolPrefix) {
      return /^https:/i.test(protocolPrefix) ? 'https://' : 'http://';
    });
  }

  // Handle protocol-relative URLs.
  if (normalizedValue.indexOf('//') === 0) {
    return 'https:' + normalizedValue;
  }

  // Handle bare Cloudinary host paths.
  if (/^res\.cloudinary\.com\//i.test(normalizedValue)) {
    return 'https://' + normalizedValue;
  }

  if (/^https?:\/\//i.test(normalizedValue)) {
    // Avoid mixed-content issues when Cloudinary URLs are stored as http.
    if (/^http:\/\/res\.cloudinary\.com\//i.test(normalizedValue)) {
      return normalizedValue.replace(/^http:\/\//i, 'https://');
    }

    return normalizedValue;
  }

  if (normalizedValue.charAt(0) === '.') {
    normalizedValue = normalizedValue.replace(/^\.+/, '');
  }

  if (normalizedValue.charAt(0) === '/') {
    return normalizedValue;
  }

  return '/' + normalizedValue.replace(/^\/+/, '');
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

function getCachedImageAssetExistence(publicFilePath) {
  var cacheEntry = imageAssetExistenceCache[publicFilePath];
  if (!cacheEntry || cacheEntry.expiresAt < Date.now()) {
    return null;
  }

  return Boolean(cacheEntry.exists);
}

function setCachedImageAssetExistence(publicFilePath, exists) {
  if (!publicFilePath) {
    return;
  }

  imageAssetExistenceCache[publicFilePath] = {
    exists: Boolean(exists),
    expiresAt: Date.now() + imageAssetCheckCacheTtlMs,
  };
}

function doesImageAssetExist(assetPath) {
  var publicFilePath = getPublicFilePathFromAssetPath(assetPath);
  var cachedExists = null;
  var fileExists = false;

  if (!publicFilePath) {
    return false;
  }

  cachedExists = getCachedImageAssetExistence(publicFilePath);
  if (typeof cachedExists === 'boolean') {
    return cachedExists;
  }

  fileExists = fs.existsSync(publicFilePath);
  setCachedImageAssetExistence(publicFilePath, fileExists);
  return fileExists;
}

function isRenderableImagePath(assetPath) {
  var normalizedPath = normalizeAssetPath(assetPath);
  var publicFilePath = '';
  var cachedExists = null;

  if (!normalizedPath) {
    return false;
  }

  if (/^https?:\/\//i.test(normalizedPath)) {
    return true;
  }

  // Local product and catalog image paths are managed under public assets.
  // Fast-path avoids synchronous disk checks on hot request paths.
  if (
    normalizedPath.indexOf('/uploads/products/') === 0 ||
    normalizedPath.indexOf('/images/') === 0
  ) {
    publicFilePath = getPublicFilePathFromAssetPath(normalizedPath);
    cachedExists = getCachedImageAssetExistence(publicFilePath);
    if (typeof cachedExists === 'boolean') {
      return cachedExists;
    }

    setCachedImageAssetExistence(publicFilePath, true);
    return true;
  }

  return doesImageAssetExist(normalizedPath);
}

function ensureRenderableImagePath(assetPath) {
  var normalizedPath = normalizeAssetPath(assetPath);

  return isRenderableImagePath(normalizedPath) ? normalizedPath : '';
}

function getUploadedImagePath(file) {
  if (!file || !file.filename) {
    return '';
  }

  return '/uploads/products/' + file.filename;
}

async function deleteFileSafely(filePath) {
  if (!filePath) {
    return false;
  }

  try {
    await fs.promises.unlink(filePath);
    setCachedImageAssetExistence(filePath, false);
    return true;
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      setCachedImageAssetExistence(filePath, false);
      return false;
    }
    console.error('Failed to remove temporary upload file:', error.message);
    return false;
  }
}

async function optimizeUploadedImageLocally(file) {
  var sourceFilePath = file && file.path ? file.path : '';
  var uploadedImagePath = getUploadedImagePath(file);

  if (!sourceFilePath || !uploadedImagePath) {
    return uploadedImagePath;
  }

  var sourcePathParts = path.parse(sourceFilePath);
  var optimizedBaseName = sourcePathParts.name + '-opt.webp';
  var optimizedFilePath = path.join(sourcePathParts.dir, optimizedBaseName);

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

    var optimizedAssetPath = '/uploads/products/' + optimizedBaseName;
    setCachedImageAssetExistence(getPublicFilePathFromAssetPath(optimizedAssetPath), true);
    return optimizedAssetPath;
  } catch (error) {
    console.error('Failed to optimize uploaded image:', error.message);
    setCachedImageAssetExistence(getPublicFilePathFromAssetPath(uploadedImagePath), true);
    return uploadedImagePath;
  }
}

async function optimizeUploadedImage(file) {
  return optimizeUploadedImageLocally(file);
}

function isCloudinaryUrl(assetPath) {
  return /^https?:\/\/res\.cloudinary\.com\//i.test(normalizeAssetPath(assetPath));
}

async function uploadImageSourceToCloudinary(sourcePath, fallbackPath) {
  var uploadResult = null;
  var secureUrl = '';
  var uploadUrl = '';

  try {
    uploadResult = await cloudinaryClient.cloudinary.uploader.upload(sourcePath, {
      folder: cloudinaryUploadFolder,
      resource_type: 'image',
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
  var safeFallbackPath = normalizeAssetPath(fallbackPath);
  var uploadPromise = uploadImageSourceToCloudinary(sourcePath, safeFallbackPath).catch(function () {
    return safeFallbackPath;
  });
  var timeoutPromise = null;

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return uploadPromise;
  }

  timeoutPromise = new Promise(function (resolve) {
    setTimeout(function () {
      resolve(safeFallbackPath);
    }, timeoutMs);
  });

  return Promise.race([uploadPromise, timeoutPromise]);
}

async function promoteImageToCloudinary(assetPath) {
  var normalizedAssetPath = normalizeAssetPath(assetPath);
  var localFilePath = '';

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
  var localImagePath = normalizeAssetPath(await optimizeUploadedImage(file));
  var localFilePath = '';
  var cloudImagePath = '';

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
  var normalizedAssetPath = normalizeAssetPath(assetPath);
  var localFilePath = '';

  if (!normalizedAssetPath || /^https?:\/\//i.test(normalizedAssetPath)) {
    return;
  }

  localFilePath = getPublicFilePathFromAssetPath(normalizedAssetPath);
  if (!localFilePath) {
    return;
  }

  await deleteFileSafely(localFilePath);
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

function buildAdminProductOrderLookup() {
  var orderLookup = Object.create(null);

  if (!adminData || !Array.isArray(adminData.products)) {
    return orderLookup;
  }

  adminData.products.forEach(function (product, index) {
    var productId = toTrimmedString(product && product.id);

    if (!productId) {
      return;
    }

    // Higher index means product was added later.
    orderLookup[productId] = index + 1;
  });

  return orderLookup;
}

function getProductAddedOrder(productId, adminProductOrderLookup) {
  var cleanId = toTrimmedString(productId);
  var rawOrder = cleanId && adminProductOrderLookup ? Number(adminProductOrderLookup[cleanId]) : 0;

  if (!Number.isFinite(rawOrder) || rawOrder < 1) {
    return 0;
  }

  return Math.floor(rawOrder);
}

function sortProductsByLatestFirst(items) {
  var list = Array.isArray(items) ? items : [];

  list.sort(function (left, right) {
    var leftOrder = Number(left && left.addedOrder);
    var rightOrder = Number(right && right.addedOrder);
    var normalizedLeftOrder = Number.isFinite(leftOrder) ? leftOrder : 0;
    var normalizedRightOrder = Number.isFinite(rightOrder) ? rightOrder : 0;

    return (
      (normalizedRightOrder - normalizedLeftOrder) ||
      String(left && left.name ? left.name : '').localeCompare(String(right && right.name ? right.name : ''))
    );
  });

  return list;
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
  var productOverrideImage = normalizeAssetPath(getProductOverrideEntry(cleanId).image);
  var defaultImage = normalizeAssetPath(fallbackImage);
  var overrideImage = '';
  var candidateImages = [];
  var candidateIndex = 0;
  var candidatePath = '';

  if (
    cleanId &&
    adminData &&
    adminData.imageOverrides &&
    typeof adminData.imageOverrides === 'object'
  ) {
    overrideImage = normalizeAssetPath(adminData.imageOverrides[cleanId]);
  }

  candidateImages = [
    productOverrideImage,
    overrideImage,
    defaultImage,
  ];

  for (candidateIndex = 0; candidateIndex < candidateImages.length; candidateIndex += 1) {
    candidatePath = normalizeAssetPath(candidateImages[candidateIndex]);
    if (!candidatePath) {
      continue;
    }

    if (isRenderableImagePath(candidatePath)) {
      return candidatePath;
    }
  }

  return '';
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

function cloneProductSections(sections, adminProductOrderLookup) {
  return (sections || []).map(function (section) {
    var clonedSection = {
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
          var overridePrice = toTrimmedString(productOverride.price);
          var hasOverridePrice = Boolean(overridePrice);
          var overrideQuantity = toTrimmedString(productOverride.quantity);
          var hasOverrideQuantity = Boolean(overrideQuantity);
          var hasPriceOverride =
            itemId &&
            adminData &&
            adminData.priceOverrides &&
            Object.prototype.hasOwnProperty.call(adminData.priceOverrides, itemId);

          if (isDeletedCategory(effectiveType)) {
            return null;
          }

          var effectiveName = toTrimmedString(productOverride.name) || toTrimmedString(item.name);
          var effectiveSpec = toTrimmedString(productOverride.spec) || toTrimmedString(item.spec);
          var effectiveImage = getEffectiveImage(itemId, productOverride.image || item.image);
          var effectiveOriginalPrice = hasOverridePrice
            ? toTrimmedString(productOverride.originalPrice)
            : toTrimmedString(item.originalPrice);
          var effectiveDiscountPercent = hasOverridePrice
            ? toTrimmedString(productOverride.discountPercent)
            : toTrimmedString(item.discountPercent);
          var effectiveQuantity = hasOverrideQuantity
            ? overrideQuantity
            : toTrimmedString(item.quantity);

          if (hasPriceOverride) {
            effectiveOriginalPrice = '';
            effectiveDiscountPercent = '';
          }

          return {
            id: itemId,
            type: effectiveType,
            name: effectiveName,
            spec: effectiveSpec,
            price: getEffectivePrice(itemId, overridePrice || item.price),
            originalPrice: effectiveOriginalPrice,
            discountPercent: effectiveDiscountPercent,
            quantity: effectiveQuantity,
            image: effectiveImage,
            images: normalizeImageList(item.images, effectiveImage),
            addedOrder: getProductAddedOrder(itemId, adminProductOrderLookup),
          };
        })
        .filter(Boolean),
    };

    sortProductsByLatestFirst(clonedSection.items);
    return clonedSection;
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
    description: normalizeOptionalDescription(rawCategory.description),
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

  var image = '';
  var imageCandidates = [normalizeAssetPath(rawProduct.image)];
  var normalizedProductImages = normalizeList((rawProduct.images || []).map(function (imagePath) {
    return normalizeAssetPath(imagePath);
  }));

  imageCandidates = imageCandidates.concat(normalizedProductImages);

  imageCandidates.some(function (candidatePath) {
    if (!candidatePath || !isRenderableImagePath(candidatePath)) {
      return false;
    }

    image = candidatePath;
    return true;
  });

  return {
    id: buildSlug(rawProduct.id) || buildSlug(type + ' ' + name) || String(Date.now()),
    type: type,
    name: name,
    spec: normalizeOptionalDescription(rawProduct.spec),
    price: toTrimmedString(rawProduct.price) || 'Contact for price',
    originalPrice: toTrimmedString(rawProduct.originalPrice),
    discountPercent: toTrimmedString(rawProduct.discountPercent),
    quantity: toTrimmedString(rawProduct.quantity),
    image: image,
    images: normalizeImageList(rawProduct.images, image),
  };
}

function buildCategoryProductNameKey(categoryName, productName) {
  var categoryKey = normalizeForSearch(categoryName);
  var productKey = normalizeForSearch(productName);

  if (!categoryKey || !productKey) {
    return '';
  }

  return categoryKey + '::' + productKey;
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
  var categoryIndexByKey = Object.create(null);
  var allProducts = [];
  var dedupedProducts = [];
  var seenProductIds = Object.create(null);
  var seenCategoryProductNames = Object.create(null);
  var activeProductIdKeys = Object.create(null);
  var activeCategoryKeys = Object.create(null);
  var productIndex = 0;
  var productIdKey = '';
  var categoryProductKey = '';

  if (!rawData || typeof rawData !== 'object') {
    return safeData;
  }

  if (Array.isArray(rawData.categories)) {
    rawData.categories.forEach(function (category) {
      var safeCategory = ensureAdminCategoryShape(category);
      var safeCategoryKey = '';
      var existingCategory = null;
      if (safeCategory) {
        safeCategoryKey = normalizeForSearch(safeCategory.name);
        if (!safeCategoryKey) {
          return;
        }

        if (typeof categoryIndexByKey[safeCategoryKey] === 'number') {
          existingCategory = safeData.categories[categoryIndexByKey[safeCategoryKey]];
          if (safeCategory.description) {
            existingCategory.description = safeCategory.description;
          }
          existingCategory.items = mergeUniqueValues(existingCategory.items, safeCategory.items);
          return;
        }

        categoryIndexByKey[safeCategoryKey] = safeData.categories.length;
        safeData.categories.push(safeCategory);
      }
    });
  }

  if (Array.isArray(rawData.products)) {
    rawData.products.forEach(function (product) {
      var safeProduct = ensureAdminProductShape(product);
      if (safeProduct) {
        allProducts.push(safeProduct);
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
      var cleanSpec = normalizeOptionalDescription(rawOverride.spec);
      var cleanPrice = toTrimmedString(rawOverride.price);
      var cleanOriginalPrice = toTrimmedString(rawOverride.originalPrice);
      var cleanDiscountPercent = toTrimmedString(rawOverride.discountPercent);
      var cleanQuantity = toTrimmedString(rawOverride.quantity);
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

      if (cleanOriginalPrice) {
        normalizedOverride.originalPrice = cleanOriginalPrice;
      }

      if (cleanDiscountPercent) {
        normalizedOverride.discountPercent = cleanDiscountPercent;
      }

      if (cleanQuantity) {
        normalizedOverride.quantity = cleanQuantity;
      }

      if (cleanImage) {
        normalizedOverride.image = cleanImage;
      }

      if (Object.keys(normalizedOverride).length > 0) {
        safeData.productOverrides[cleanId] = normalizedOverride;
      }
    });
  }

  for (productIndex = allProducts.length - 1; productIndex >= 0; productIndex -= 1) {
    var candidateProduct = allProducts[productIndex];

    productIdKey = normalizeForSearch(candidateProduct && candidateProduct.id);
    categoryProductKey = buildCategoryProductNameKey(
      candidateProduct && candidateProduct.type,
      candidateProduct && candidateProduct.name
    );

    if (
      (productIdKey && seenProductIds[productIdKey]) ||
      (categoryProductKey && seenCategoryProductNames[categoryProductKey])
    ) {
      continue;
    }

    if (productIdKey) {
      seenProductIds[productIdKey] = true;
      activeProductIdKeys[productIdKey] = true;
    }

    if (categoryProductKey) {
      seenCategoryProductNames[categoryProductKey] = true;
    }

    dedupedProducts.push(candidateProduct);
  }

  safeData.products = dedupedProducts.reverse();

  safeData.products.forEach(function (product) {
    var productCategoryKey = normalizeForSearch(product && product.type);
    if (productCategoryKey) {
      activeCategoryKeys[productCategoryKey] = true;
    }
  });

  safeData.categories.forEach(function (category) {
    var categoryKey = normalizeForSearch(category && category.name);
    if (categoryKey) {
      activeCategoryKeys[categoryKey] = true;
    }
  });

  if (Array.isArray(rawData.deletedProductIds)) {
    safeData.deletedProductIds = normalizeList(rawData.deletedProductIds).filter(function (id) {
      return !activeProductIdKeys[normalizeForSearch(id)];
    });
  }

  if (Array.isArray(rawData.deletedCategoryNames)) {
    safeData.deletedCategoryNames = normalizeList(rawData.deletedCategoryNames).filter(function (name) {
      return !activeCategoryKeys[normalizeForSearch(name)];
    });
  }

  safeData.deletedProductIds.forEach(function (id) {
    delete safeData.priceOverrides[id];
    delete safeData.imageOverrides[id];
    delete safeData.productOverrides[id];
  });

  return safeData;
}

function getAdminProductById(data, productId) {
  var cleanId = toTrimmedString(productId);
  var matchedProduct = null;

  if (!cleanId || !data || !Array.isArray(data.products)) {
    return null;
  }

  data.products.some(function (product) {
    if (toTrimmedString(product && product.id) === cleanId) {
      matchedProduct = product;
      return true;
    }
    return false;
  });

  return matchedProduct;
}

function pickRenderableNonDefaultImage(candidateImages) {
  var imageCandidates = Array.isArray(candidateImages) ? candidateImages : [];
  var candidateIndex = 0;
  var normalizedCandidate = '';

  for (candidateIndex = 0; candidateIndex < imageCandidates.length; candidateIndex += 1) {
    normalizedCandidate = normalizeAssetPath(imageCandidates[candidateIndex]);
    if (!normalizedCandidate) {
      continue;
    }

    if (isRenderableImagePath(normalizedCandidate)) {
      return normalizedCandidate;
    }
  }

  return '';
}

function getFallbackImageFromAdminData(fallbackData, productId) {
  var cleanId = toTrimmedString(productId);
  var fallbackProduct = getAdminProductById(fallbackData, cleanId);
  var fallbackProductOverride = null;
  var fallbackImageOverride = '';
  var fallbackProductImages = [];
  var candidateImages = [];

  if (!cleanId || !fallbackData || typeof fallbackData !== 'object') {
    return '';
  }

  if (
    fallbackData.productOverrides &&
    typeof fallbackData.productOverrides === 'object' &&
    fallbackData.productOverrides[cleanId] &&
    typeof fallbackData.productOverrides[cleanId] === 'object'
  ) {
    fallbackProductOverride = fallbackData.productOverrides[cleanId];
  }

  if (
    fallbackData.imageOverrides &&
    typeof fallbackData.imageOverrides === 'object'
  ) {
    fallbackImageOverride = fallbackData.imageOverrides[cleanId];
  }

  if (fallbackProduct && Array.isArray(fallbackProduct.images)) {
    fallbackProductImages = fallbackProduct.images;
  }

  candidateImages = [
    fallbackProductOverride && fallbackProductOverride.image,
    fallbackImageOverride,
    fallbackProduct && fallbackProduct.image,
  ].concat(fallbackProductImages);

  return pickRenderableNonDefaultImage(candidateImages);
}

function shouldReplaceWithFallbackImage(currentImage, fallbackImage) {
  var normalizedCurrentImage = normalizeAssetPath(currentImage);
  var normalizedFallbackImage = normalizeAssetPath(fallbackImage);

  if (
    !normalizedFallbackImage ||
    !isRenderableImagePath(normalizedFallbackImage)
  ) {
    return false;
  }

  if (!normalizedCurrentImage) {
    return true;
  }

  return !isRenderableImagePath(normalizedCurrentImage);
}

function hydrateAdminImagesFromFallback(primaryData, fallbackData) {
  var didChange = false;

  if (
    !primaryData ||
    typeof primaryData !== 'object' ||
    !fallbackData ||
    typeof fallbackData !== 'object'
  ) {
    return false;
  }

  if (Array.isArray(primaryData.products)) {
    primaryData.products.forEach(function (product) {
      var cleanId = toTrimmedString(product && product.id);
      var fallbackImage = '';

      if (!cleanId || !product || typeof product !== 'object') {
        return;
      }

      fallbackImage = getFallbackImageFromAdminData(fallbackData, cleanId);
      if (!shouldReplaceWithFallbackImage(product.image, fallbackImage)) {
        return;
      }

      product.image = fallbackImage;
      product.images = normalizeImageList(product.images, fallbackImage);
      didChange = true;
    });
  }

  if (primaryData.imageOverrides && typeof primaryData.imageOverrides === 'object') {
    Object.keys(primaryData.imageOverrides).forEach(function (productId) {
      var cleanId = toTrimmedString(productId);
      var fallbackImage = '';

      if (!cleanId) {
        return;
      }

      fallbackImage = getFallbackImageFromAdminData(fallbackData, cleanId);
      if (!shouldReplaceWithFallbackImage(primaryData.imageOverrides[cleanId], fallbackImage)) {
        return;
      }

      primaryData.imageOverrides[cleanId] = fallbackImage;
      didChange = true;
    });
  }

  if (primaryData.productOverrides && typeof primaryData.productOverrides === 'object') {
    Object.keys(primaryData.productOverrides).forEach(function (productId) {
      var cleanId = toTrimmedString(productId);
      var overrideEntry = primaryData.productOverrides[productId];
      var fallbackImage = '';

      if (!cleanId || !overrideEntry || typeof overrideEntry !== 'object') {
        return;
      }

      fallbackImage = getFallbackImageFromAdminData(fallbackData, cleanId);
      if (!shouldReplaceWithFallbackImage(overrideEntry.image, fallbackImage)) {
        return;
      }

      overrideEntry.image = fallbackImage;
      didChange = true;
    });
  }

  return didChange;
}

function hasCloudinaryMigrationCandidateImage(assetPath) {
  var normalizedPath = normalizeAssetPath(assetPath);

  if (!normalizedPath) {
    return false;
  }

  return !isCloudinaryUrl(normalizedPath);
}

function hasCloudinaryMigrationCandidates(data) {
  var productIndex = 0;
  var imageIndex = 0;
  var product = null;
  var productOverrideKeys = [];
  var imageOverrideKeys = [];
  var productOverride = null;
  var key = '';

  if (!data || typeof data !== 'object') {
    return false;
  }

  if (Array.isArray(data.products)) {
    for (productIndex = 0; productIndex < data.products.length; productIndex += 1) {
      product = data.products[productIndex];
      if (!product || typeof product !== 'object') {
        continue;
      }

      if (hasCloudinaryMigrationCandidateImage(product.image)) {
        return true;
      }

      if (!Array.isArray(product.images)) {
        continue;
      }

      for (imageIndex = 0; imageIndex < product.images.length; imageIndex += 1) {
        if (hasCloudinaryMigrationCandidateImage(product.images[imageIndex])) {
          return true;
        }
      }
    }
  }

  if (data.imageOverrides && typeof data.imageOverrides === 'object') {
    imageOverrideKeys = Object.keys(data.imageOverrides);
    for (productIndex = 0; productIndex < imageOverrideKeys.length; productIndex += 1) {
      key = imageOverrideKeys[productIndex];
      if (hasCloudinaryMigrationCandidateImage(data.imageOverrides[key])) {
        return true;
      }
    }
  }

  if (data.productOverrides && typeof data.productOverrides === 'object') {
    productOverrideKeys = Object.keys(data.productOverrides);
    for (productIndex = 0; productIndex < productOverrideKeys.length; productIndex += 1) {
      key = productOverrideKeys[productIndex];
      productOverride = data.productOverrides[key];
      if (!productOverride || typeof productOverride !== 'object') {
        continue;
      }

      if (hasCloudinaryMigrationCandidateImage(productOverride.image)) {
        return true;
      }
    }
  }

  return false;
}

async function promoteImagePathWithCache(assetPath, cache) {
  var normalizedPath = normalizeAssetPath(assetPath);
  var cacheKey = normalizedPath;
  var promotedPath = '';

  if (!normalizedPath || isCloudinaryUrl(normalizedPath)) {
    return normalizedPath;
  }

  if (cache && Object.prototype.hasOwnProperty.call(cache, cacheKey)) {
    return cache[cacheKey];
  }

  promotedPath = await promoteImageToCloudinary(normalizedPath);
  promotedPath = normalizeAssetPath(promotedPath || normalizedPath);

  if (cache) {
    cache[cacheKey] = promotedPath || normalizedPath;
    return cache[cacheKey];
  }

  return promotedPath || normalizedPath;
}

async function promoteAdminDataImagesToCloudinary(data) {
  var didChange = false;
  var promotionCache = Object.create(null);
  var productIndex = 0;
  var imageIndex = 0;
  var product = null;
  var originalImage = '';
  var promotedImage = '';
  var originalListImage = '';
  var promotedListImage = '';
  var promotedImages = [];
  var imageOverrideKeys = [];
  var productOverrideKeys = [];
  var key = '';
  var overrideEntry = null;
  var originalOverrideImage = '';
  var promotedOverrideImage = '';

  if (!data || typeof data !== 'object') {
    return false;
  }

  if (Array.isArray(data.products)) {
    for (productIndex = 0; productIndex < data.products.length; productIndex += 1) {
      product = data.products[productIndex];
      if (!product || typeof product !== 'object') {
        continue;
      }

      originalImage = normalizeAssetPath(product.image);
      promotedImage = await promoteImagePathWithCache(originalImage, promotionCache);
      if (promotedImage && promotedImage !== originalImage) {
        product.image = promotedImage;
        didChange = true;
      }

      if (Array.isArray(product.images)) {
        promotedImages = [];

        for (imageIndex = 0; imageIndex < product.images.length; imageIndex += 1) {
          originalListImage = normalizeAssetPath(product.images[imageIndex]);
          promotedListImage = await promoteImagePathWithCache(originalListImage, promotionCache);

          if (promotedListImage) {
            promotedImages.push(promotedListImage);
          }

          if (promotedListImage && promotedListImage !== originalListImage) {
            didChange = true;
          }
        }

        product.images = normalizeImageList(promotedImages, product.image);
      } else {
        product.images = normalizeImageList([], product.image);
      }
    }
  }

  if (data.imageOverrides && typeof data.imageOverrides === 'object') {
    imageOverrideKeys = Object.keys(data.imageOverrides);

    for (productIndex = 0; productIndex < imageOverrideKeys.length; productIndex += 1) {
      key = imageOverrideKeys[productIndex];
      originalOverrideImage = normalizeAssetPath(data.imageOverrides[key]);
      promotedOverrideImage = await promoteImagePathWithCache(originalOverrideImage, promotionCache);

      if (promotedOverrideImage && promotedOverrideImage !== originalOverrideImage) {
        data.imageOverrides[key] = promotedOverrideImage;
        didChange = true;
      }
    }
  }

  if (data.productOverrides && typeof data.productOverrides === 'object') {
    productOverrideKeys = Object.keys(data.productOverrides);

    for (productIndex = 0; productIndex < productOverrideKeys.length; productIndex += 1) {
      key = productOverrideKeys[productIndex];
      overrideEntry = data.productOverrides[key];

      if (!overrideEntry || typeof overrideEntry !== 'object') {
        continue;
      }

      originalOverrideImage = normalizeAssetPath(overrideEntry.image);
      promotedOverrideImage = await promoteImagePathWithCache(originalOverrideImage, promotionCache);

      if (promotedOverrideImage && promotedOverrideImage !== originalOverrideImage) {
        overrideEntry.image = promotedOverrideImage;
        didChange = true;
      }
    }
  }

  return didChange;
}

async function maybePromoteAdminImagesToCloudinary() {
  var now = Date.now();
  var didChange = false;
  var didSave = false;

  if (!cloudinaryClient.isCloudinaryConfigured()) {
    return false;
  }

  if (!hasCloudinaryMigrationCandidates(adminData)) {
    return false;
  }

  if (isCloudinaryMigrationInProgress) {
    return false;
  }

  if ((now - lastCloudinaryImageMigrationAt) < cloudinaryImageMigrationCooldownMs) {
    return false;
  }

  isCloudinaryMigrationInProgress = true;
  lastCloudinaryImageMigrationAt = now;

  try {
    didChange = await promoteAdminDataImagesToCloudinary(adminData);

    if (!didChange) {
      return false;
    }

    didSave = await saveAdminData();
    if (!didSave) {
      console.error('Promoted images to Cloudinary, but failed to persist updated image URLs.');
    }

    return didSave;
  } finally {
    isCloudinaryMigrationInProgress = false;
    lastCloudinaryImageMigrationAt = Date.now();
  }
}

function runCloudinaryMigrationInBackground() {
  maybePromoteAdminImagesToCloudinary().catch(function (error) {
    console.error('Background Cloudinary migration failed:', error && error.message ? error.message : error);
  });
}

function loadAdminDataFromFile() {
  return adminDataStore.loadFromFile(createDefaultAdminData, normalizeAdminDataShape);
}

async function loadAdminDataFromFileAsync() {
  return adminDataStore.loadFromFileAsync(createDefaultAdminData, normalizeAdminDataShape);
}

async function saveAdminDataToFile(data) {
  var payload = data && typeof data === 'object' ? data : adminData;
  return adminDataStore.saveToFile(payload, normalizeAdminDataShape, createDefaultAdminData);
}

async function loadAdminDataFromDatabase() {
  var storedData = await adminDataStore.loadFromDatabase(normalizeAdminDataShape, createDefaultAdminData);
  if (!storedData) {
    return false;
  }

  adminData = storedData;
  clearCatalogContextCache();
  return true;
}

async function refreshAdminData() {
  var loadedFromDatabase = await loadAdminDataFromDatabase();
  var fileBackupData = null;

  if (loadedFromDatabase) {
    fileBackupData = await loadAdminDataFromFileAsync();

    if (hydrateAdminImagesFromFallback(adminData, fileBackupData)) {
      clearCatalogContextCache();
      await saveAdminData();
    }

    runCloudinaryMigrationInBackground();
    return true;
  }

  adminData = await loadAdminDataFromFileAsync();
  clearCatalogContextCache();

  if (isMongoStorageEnabled() && !hasAttemptedDatabaseBootstrap) {
    hasAttemptedDatabaseBootstrap = true;
    await saveAdminData();
  }

  runCloudinaryMigrationInBackground();
  return true;
}

async function saveAdminData() {
  var normalizedData = normalizeAdminDataShape(adminData);
  var mongoEnabled = isMongoStorageEnabled();
  var didSaveToDatabase = false;
  var didSaveToFile = false;

  if (mongoEnabled) {
    didSaveToDatabase = await adminDataStore.saveToDatabase(
      normalizedData,
      normalizeAdminDataShape,
      createDefaultAdminData
    );

    if (!didSaveToDatabase) {
      return false;
    }

    // Keep file in sync as a local backup after primary DB write succeeds.
    didSaveToFile = await saveAdminDataToFile(normalizedData);
    if (!didSaveToFile) {
      console.error('Saved admin data in database, but failed to sync admin-data.json.');
      return false;
    }

    adminData = normalizedData;
    clearCatalogContextCache();
    runCloudinaryMigrationInBackground();
    return true;
  }

  didSaveToFile = await saveAdminDataToFile(normalizedData);
  if (!didSaveToFile) {
    return false;
  }

  adminData = normalizedData;
  clearCatalogContextCache();
  runCloudinaryMigrationInBackground();
  return true;
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
      description: normalizeOptionalDescription(category.description),
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
        description: '',
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
  var adminProductOrderLookup = buildAdminProductOrderLookup();
  var mergedSections = cloneProductSections(baseProductSections, adminProductOrderLookup);
  var adminSectionMap = Object.create(null);

  adminData.products.forEach(function (product) {
    if (isDeletedProduct(product.id)) {
      return;
    }

    var productOverride = getProductOverrideEntry(product.id);
    var effectiveCategoryName = toTrimmedString(productOverride.type) || toTrimmedString(product.type) || 'Other';
    var overridePrice = toTrimmedString(productOverride.price);
    var hasOverridePrice = Boolean(overridePrice);
    var overrideQuantity = toTrimmedString(productOverride.quantity);
    var hasOverrideQuantity = Boolean(overrideQuantity);
    var hasPriceOverride =
      product.id &&
      adminData &&
      adminData.priceOverrides &&
      Object.prototype.hasOwnProperty.call(adminData.priceOverrides, product.id);

    if (isDeletedCategory(effectiveCategoryName)) {
      return;
    }

    var effectiveName = toTrimmedString(productOverride.name) || toTrimmedString(product.name);
    var effectiveSpec = normalizeOptionalDescription(toTrimmedString(productOverride.spec) || toTrimmedString(product.spec));
    var effectivePrice = getEffectivePrice(product.id, overridePrice || product.price);
    var effectiveOriginalPrice = hasOverridePrice
      ? toTrimmedString(productOverride.originalPrice)
      : toTrimmedString(product.originalPrice);
    var effectiveDiscountPercent = hasOverridePrice
      ? toTrimmedString(productOverride.discountPercent)
      : toTrimmedString(product.discountPercent);
    var effectiveQuantity = hasOverrideQuantity
      ? overrideQuantity
      : toTrimmedString(product.quantity);
    var sectionKey = normalizeForSearch(effectiveCategoryName) || 'other';

    if (!adminSectionMap[sectionKey]) {
      adminSectionMap[sectionKey] = {
        title: effectiveCategoryName + ' (Admin)',
        subtitle: 'Products added from admin panel',
        items: [],
      };
    }

    var effectiveImage = getEffectiveImage(product.id, productOverride.image || product.image || '');

    if (hasPriceOverride) {
      effectiveOriginalPrice = '';
      effectiveDiscountPercent = '';
    }

    adminSectionMap[sectionKey].items.push({
      id: product.id,
      type: effectiveCategoryName,
      name: effectiveName,
      spec: effectiveSpec,
      price: effectivePrice,
      originalPrice: effectiveOriginalPrice,
      discountPercent: effectiveDiscountPercent,
      quantity: effectiveQuantity,
      image: effectiveImage,
      images: normalizeImageList(product.images, effectiveImage),
      addedOrder: getProductAddedOrder(product.id, adminProductOrderLookup),
    });
  });

  Object.keys(adminSectionMap)
    .forEach(function (sectionKey) {
      sortProductsByLatestFirst(adminSectionMap[sectionKey].items);
    });

  Object.keys(adminSectionMap)
    .sort(function (leftKey, rightKey) {
      var leftItems = adminSectionMap[leftKey].items || [];
      var rightItems = adminSectionMap[rightKey].items || [];
      var leftTopOrder = Number(leftItems[0] && leftItems[0].addedOrder) || 0;
      var rightTopOrder = Number(rightItems[0] && rightItems[0].addedOrder) || 0;

      return (rightTopOrder - leftTopOrder) || leftKey.localeCompare(rightKey);
    })
    .forEach(function (sectionKey) {
      mergedSections.push(adminSectionMap[sectionKey]);
    });

  mergedSections.sort(function (leftSection, rightSection) {
    var leftItems = leftSection && Array.isArray(leftSection.items) ? leftSection.items : [];
    var rightItems = rightSection && Array.isArray(rightSection.items) ? rightSection.items : [];
    var leftTopOrder = Number(leftItems[0] && leftItems[0].addedOrder) || 0;
    var rightTopOrder = Number(rightItems[0] && rightItems[0].addedOrder) || 0;

    return (
      (rightTopOrder - leftTopOrder) ||
      String(leftSection && leftSection.title ? leftSection.title : '').localeCompare(String(rightSection && rightSection.title ? rightSection.title : ''))
    );
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
          description: '',
          items: [],
        });
        groupIndex = syncedGroups.length - 1;
        groupIndexByKey[categoryKey] = groupIndex;
      }

      var nextItems = [item.name];
      var coverageLabel = getHelmetCoverageLabel(item);

      if (coverageLabel) {
        nextItems.push(coverageLabel);
      }

      syncedGroups[groupIndex].items = mergeUniqueValues(syncedGroups[groupIndex].items, nextItems);
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
    var itemNames = [];

    if (!matchedBoard) {
      return;
    }

    itemNames = (matchedBoard.items || [])
      .map(function (item) {
        var normalizedNames = [toTrimmedString(item && item.name)];
        var coverageLabel = getHelmetCoverageLabel(item);

        if (coverageLabel) {
          normalizedNames.push(coverageLabel);
        }

        return normalizedNames;
      })
      .reduce(function (flatList, names) {
        return flatList.concat(names || []);
      }, [])
      .filter(Boolean);

    group.items = mergeUniqueValues(group.items, itemNames);
  });

  return syncedGroups;
}

function getCatalogContext() {
  var now = Date.now();

  if (catalogCacheTtlMs > 0 && cachedCatalogContext && now < cachedCatalogContextExpiresAt) {
    return cachedCatalogContext;
  }

  var productSections = getMergedProductSections();
  var categoryGroups = getMergedCategoryGroups();
  var categoryKeywordMap = getMergedCategoryKeywordMap(categoryGroups);
  var categoryBoards = [];

  categoryGroups = syncCategoryGroupsWithProducts(categoryGroups, productSections, categoryKeywordMap);
  categoryBoards = buildAdminCategoryBoards(categoryGroups, productSections, categoryKeywordMap);
  categoryGroups = syncCategoryGroupsWithAdminBoards(categoryGroups, categoryBoards);
  categoryKeywordMap = getMergedCategoryKeywordMap(categoryGroups);

  var context = {
    categoryGroups: categoryGroups,
    productSections: productSections,
    categoryKeywordMap: categoryKeywordMap,
  };

  if (catalogCacheTtlMs > 0) {
    cachedCatalogContext = context;
    cachedCatalogContextExpiresAt = now + catalogCacheTtlMs;
  }

  return context;
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
  var searchableText = normalizeForSearch(buildProductSearchableText(item, section));

  return keywords.some(function (keyword) {
    return searchableText.indexOf(normalizeForSearch(keyword)) !== -1;
  });
}

function filterProductData(query, selectedCategory, productSections, categoryKeywordMap) {
  var hasQuery = Boolean(query);

  return productSections
    .map(function (section) {
      var filteredItems = section.items.filter(function (item) {
        var searchableText = buildProductSearchableText(item, section);
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

  (productSections || []).forEach(function (section) {
    section.items.forEach(function (item) {
      if (item.id) {
        usedIds[item.id] = true;
      }
    });
  });

  (adminData.products || []).forEach(function (product) {
    var existingId = toTrimmedString(product && product.id);
    if (existingId) {
      usedIds[existingId] = true;
    }
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
  var adminProductOrderLookup = buildAdminProductOrderLookup();

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

      board.items.push({
        id: item.id,
        type: item.type,
        name: item.name,
        spec: item.spec,
        price: item.price,
        originalPrice: toTrimmedString(item.originalPrice),
        discountPercent: toTrimmedString(item.discountPercent),
        quantity: toTrimmedString(item.quantity),
        image: item.image,
        addedOrder: getProductAddedOrder(item.id, adminProductOrderLookup),
      });
    });
  });

  return orderedKeys.map(function (key) {
    var board = boardMap[key];
    sortProductsByLatestFirst(board.items);
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

function upsertAdminCategory(categoryName, categoryDescription, categoryItems, options) {
  var cleanedName = toTrimmedString(categoryName);
  var cleanedDescription = toTrimmedString(categoryDescription);
  var settings = options && typeof options === 'object' ? options : {};
  var cleanedOriginalName = toTrimmedString(settings.originalName);
  var shouldUpdateDescription = Boolean(settings.updateDescription);
  var shouldReplaceItems = Boolean(settings.replaceItems);
  var targetCategoryKey = normalizeForSearch(cleanedName);
  var originalCategoryKey = normalizeForSearch(cleanedOriginalName);
  var existingCategory = null;
  var originalCategory = null;
  var categoryIndex = -1;
  var productOverrideKeys = [];
  var keyIndex = 0;
  var overrideKey = '';
  var overrideEntry = null;

  if (!cleanedName) {
    return null;
  }

  removeDeletedCategory(cleanedName);
  if (cleanedOriginalName) {
    removeDeletedCategory(cleanedOriginalName);
  }

  existingCategory = findAdminCategoryByName(cleanedName);

  if (originalCategoryKey && originalCategoryKey !== targetCategoryKey) {
    originalCategory = findAdminCategoryByName(cleanedOriginalName);

    if (originalCategory && existingCategory && originalCategory !== existingCategory) {
      existingCategory.items = mergeUniqueValues(existingCategory.items, originalCategory.items);

      if (!toTrimmedString(existingCategory.description) && toTrimmedString(originalCategory.description)) {
        existingCategory.description = toTrimmedString(originalCategory.description);
      }

      categoryIndex = adminData.categories.indexOf(originalCategory);
      if (categoryIndex !== -1) {
        adminData.categories.splice(categoryIndex, 1);
      }
    } else if (originalCategory && !existingCategory) {
      originalCategory.name = cleanedName;
      existingCategory = originalCategory;
    }

    if (Array.isArray(adminData.products)) {
      adminData.products.forEach(function (product) {
        var productCategoryKey = normalizeForSearch(product && product.type);
        if (productCategoryKey === originalCategoryKey) {
          product.type = cleanedName;
        }
      });
    }

    if (adminData.productOverrides && typeof adminData.productOverrides === 'object') {
      productOverrideKeys = Object.keys(adminData.productOverrides);

      for (keyIndex = 0; keyIndex < productOverrideKeys.length; keyIndex += 1) {
        overrideKey = productOverrideKeys[keyIndex];
        overrideEntry = adminData.productOverrides[overrideKey];

        if (!overrideEntry || typeof overrideEntry !== 'object') {
          continue;
        }

        if (normalizeForSearch(overrideEntry.type) === originalCategoryKey) {
          overrideEntry.type = cleanedName;
        }
      }
    }
  }

  if (!existingCategory) {
    existingCategory = {
      name: cleanedName,
      description: normalizeOptionalDescription(cleanedDescription),
      items: normalizeList(categoryItems),
    };
    adminData.categories.push(existingCategory);
    return existingCategory;
  }

  existingCategory.name = cleanedName;

  if (shouldUpdateDescription) {
    existingCategory.description = normalizeOptionalDescription(cleanedDescription);
  }

  if (shouldReplaceItems) {
    existingCategory.items = normalizeList(categoryItems);
  } else if (Array.isArray(categoryItems) && categoryItems.length > 0) {
    existingCategory.items = mergeUniqueValues(existingCategory.items, categoryItems);
  }

  return existingCategory;
}

function getAdminStatusMessage(statusCode) {
  if (statusCode === 'login-success') {
    return 'Welcome! You have successfully logged in.';
  }

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

  if (statusCode === 'order-accepted') {
    return 'Order accepted. Customer notification is being sent.';
  }

  if (statusCode === 'order-deleted') {
    return 'Order request deleted successfully.';
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
    return 'Could not save data. Check file permissions and try again.';
  }

  if (errorCode === 'db-unavailable') {
    return 'Database is unavailable. Please try again later.';
  }

  if (errorCode === 'invalid-input') {
    return 'Input is invalid. Please review your values and try again.';
  }

  if (errorCode === 'duplicate-product') {
    return 'A product with the same category and subcategory already exists.';
  }

  if (errorCode === 'duplicate-category') {
    return 'A category with the same name already exists.';
  }

  return '';
}

module.exports = {
  buildAdminCategoryBoards: buildAdminCategoryBoards,
  buildCategoryViewData: buildCategoryViewData,
  buildSearchSuggestions: buildSearchSuggestions,
  buildUniqueProductId: buildUniqueProductId,
  countItems: countItems,
  defaultProductImagePath: defaultProductImagePath,
  filterProductData: filterProductData,
  findProductById: findProductById,
  getAdminData: function () {
    return adminData;
  },
  getAdminErrorMessage: getAdminErrorMessage,
  getAdminStatusMessage: getAdminStatusMessage,
  getCatalogContext: getCatalogContext,
  getOpenCategoryName: getOpenCategoryName,
  getProductOverrideEntry: getProductOverrideEntry,
  optimizeUploadedImage: optimizeUploadedImage,
  optimizeAndPromoteUploadedImage: optimizeAndPromoteUploadedImage,
  promoteImageToCloudinary: promoteImageToCloudinary,
  cleanupLocalImageAsset: cleanupLocalImageAsset,
  getUploadedImagePath: getUploadedImagePath,
  homeCarouselImages: homeCarouselImages,
  imageUpload: imageUpload,
  isDeletedCategory: isDeletedCategory,
  normalizeAssetPath: normalizeAssetPath,
  normalizeForSearch: normalizeForSearch,
  normalizeImageList: normalizeImageList,
  normalizeList: normalizeList,
  parseCommaSeparatedList: parseCommaSeparatedList,
  refreshAdminData: refreshAdminData,
  resolveCategoryName: resolveCategoryName,
  saveAdminData: saveAdminData,
  toTrimmedString: toTrimmedString,
  upsertAdminCategory: upsertAdminCategory,
};
