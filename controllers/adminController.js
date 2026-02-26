var catalogService = require('../services/catalogService');
var database = require('../lib/db');
var resendService = require('../services/resendService');
var Order = require('../models/Order');
var defaultAdminPath = '/admin';
var maxCategoryNameLength = 80;
var maxCategoryDescriptionLength = 240;
var maxCategoryItemsCount = 50;
var maxProductNameLength = 120;
var maxProductSpecLength = 600;
var maxPriceValue = 100000000;
var maxQuantityValue = 1000000;
var adminProductOverviewPageSize = 20;
var adminCategoryItemsPageSize = 12;
var maxAdminOrderMessageLength = 1000;
var adminOrderRequestsLimit = 150;
var adminOrderRequestsPageSize = 10;
var defaultAdminOrdersPath = '/admin/orders';

function toCategorySlug(value) {
  return catalogService.normalizeForSearch(value).replace(/\s+/g, '-');
}

function buildCategoryAdminPath(categoryName) {
  var categorySlug = toCategorySlug(categoryName);
  if (!categorySlug) {
    return defaultAdminPath;
  }
  return '/admin/categories/' + categorySlug;
}

function getSafeRedirectPath(req, fallbackPath) {
  var targetPath = catalogService.toTrimmedString(req && req.body ? req.body.redirectTo : '');
  var safeFallbackPath = fallbackPath || defaultAdminPath;

  if (!targetPath) {
    return safeFallbackPath;
  }

  if (targetPath.charAt(0) !== '/') {
    return safeFallbackPath;
  }

  if (targetPath.indexOf('/admin') !== 0) {
    return safeFallbackPath;
  }

  return targetPath;
}

function appendRedirectParam(path, key, value) {
  var safePath = path || defaultAdminPath;
  var separator = safePath.indexOf('?') === -1 ? '?' : '&';
  return safePath + separator + key + '=' + encodeURIComponent(value);
}

function buildErrorRedirect(path, errorCode) {
  return appendRedirectParam(path, 'error', errorCode);
}

function buildStatusRedirect(path, statusCode) {
  return appendRedirectParam(path, 'status', statusCode);
}

function normalizeSingleLineText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeMultilineText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function isLikelyEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, function (character) {
    if (character === '&') {
      return '&amp;';
    }
    if (character === '<') {
      return '&lt;';
    }
    if (character === '>') {
      return '&gt;';
    }
    if (character === '"') {
      return '&quot;';
    }
    return '&#39;';
  });
}

async function ensureDatabaseConnection() {
  return database.connectToDatabase();
}

function isWithinLength(value, maxLength) {
  return normalizeMultilineText(value).length <= maxLength;
}

function isValidEntityId(value) {
  return /^[a-z0-9][a-z0-9-]*$/i.test(catalogService.toTrimmedString(value));
}

function parsePositiveInteger(value, fallbackValue) {
  var parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallbackValue;
  }

  return Math.floor(parsedValue);
}

function hasValidPriceValue(value) {
  var parsedValue = parseNonNegativeNumber(value);
  return Number.isFinite(parsedValue) && parsedValue <= maxPriceValue;
}

function hasValidQuantityValue(value) {
  var parsedValue = parseNonNegativeNumber(value);
  return Number.isFinite(parsedValue) && parsedValue <= maxQuantityValue;
}

function parseStoredStockQuantity(value) {
  var quantityText = catalogService.toTrimmedString(value);
  var parsedValue = parseNonNegativeNumber(quantityText);

  if (!quantityText || !Number.isFinite(parsedValue)) {
    return 0;
  }

  return Math.floor(parsedValue);
}

function sanitizeCategoryItems(rawItems) {
  var parsedItems = catalogService.parseCommaSeparatedList(rawItems);

  return parsedItems
    .slice(0, maxCategoryItemsCount)
    .map(function (item) {
      return normalizeSingleLineText(item);
    })
    .filter(function (item) {
      return item && item.length <= maxProductNameLength;
    });
}

function hasDuplicateProductName(categoryName, productName, productSections, productIdToIgnore) {
  var categoryKey = catalogService.normalizeForSearch(categoryName);
  var productNameKey = catalogService.normalizeForSearch(productName);

  if (!categoryKey || !productNameKey) {
    return false;
  }

  return (productSections || []).some(function (section) {
    return (section.items || []).some(function (item) {
      if (!item || item.id === productIdToIgnore) {
        return false;
      }

      return (
        catalogService.normalizeForSearch(item.type) === categoryKey &&
        catalogService.normalizeForSearch(item.name) === productNameKey
      );
    });
  });
}

function normalizeHelmetCoverage(value) {
  var normalizedCoverage = catalogService.normalizeForSearch(value);

  if (normalizedCoverage === 'half') {
    return 'Half';
  }

  if (normalizedCoverage === 'full') {
    return 'Full';
  }

  return '';
}

function buildProductSpec(categoryName, rawSpec, rawHelmetCoverage) {
  var categoryKey = catalogService.normalizeForSearch(categoryName);
  var specText = catalogService.toTrimmedString(rawSpec);
  var helmetCoverage = normalizeHelmetCoverage(rawHelmetCoverage);

  if (categoryKey === 'helmet' && helmetCoverage) {
    if (specText) {
      return 'Type: ' + helmetCoverage + ' | ' + specText;
    }

    return 'Type: ' + helmetCoverage;
  }

  return specText || 'N/A';
}

function parseNonNegativeNumber(value) {
  var rawValue = catalogService.toTrimmedString(value).replace(/,/g, '');
  var matchedValue = rawValue.match(/-?\d+(\.\d+)?/);
  var parsedValue = matchedValue ? Number(matchedValue[0]) : NaN;

  if (!matchedValue || !Number.isFinite(parsedValue) || parsedValue < 0) {
    return NaN;
  }

  return parsedValue;
}

function formatNprAmount(value) {
  var normalizedValue = Math.round(value * 100) / 100;
  var hasDecimals = Math.abs(normalizedValue % 1) > 0;

  return 'NPR ' + normalizedValue.toLocaleString('en-US', {
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

function normalizeDiscountPercent(value) {
  var parsedValue = parseNonNegativeNumber(value);
  if (!Number.isFinite(parsedValue)) {
    return 0;
  }

  return Math.min(Math.round(parsedValue * 100) / 100, 100);
}

function normalizeProductQuantity(value) {
  var parsedValue = parseNonNegativeNumber(value);
  if (!Number.isFinite(parsedValue)) {
    return '';
  }

  return String(Math.floor(parsedValue));
}

function resolveProductPricing(rawPrice, rawDiscountPercent) {
  var priceInput = catalogService.toTrimmedString(rawPrice);
  var parsedMrp = parseNonNegativeNumber(priceInput);
  var discountPercent = normalizeDiscountPercent(rawDiscountPercent);

  if (!priceInput) {
    return {
      isPriceMissing: true,
      price: '',
      originalPrice: '',
      discountPercent: 0,
    };
  }

  if (!Number.isFinite(parsedMrp)) {
    return {
      isPriceMissing: false,
      price: priceInput,
      originalPrice: '',
      discountPercent: 0,
    };
  }

  var discountedValue = parsedMrp * ((100 - discountPercent) / 100);
  var hasDiscount = discountPercent > 0 && discountedValue < parsedMrp;

  return {
    isPriceMissing: false,
    price: formatNprAmount(discountedValue),
    originalPrice: hasDiscount ? formatNprAmount(parsedMrp) : '',
    discountPercent: hasDiscount ? discountPercent : 0,
  };
}

function findCategoryBoardBySlug(categorySlug, categoryBoards) {
  var slug = catalogService.toTrimmedString(categorySlug).toLowerCase();
  var normalizedSlug = catalogService.normalizeForSearch(slug.replace(/-/g, ' '));
  var matchedBySlug = null;

  if (!slug) {
    return null;
  }

  matchedBySlug = (categoryBoards || []).find(function (board) {
    return toCategorySlug(board && board.name) === slug;
  }) || null;

  if (matchedBySlug) {
    return matchedBySlug;
  }

  return (categoryBoards || []).find(function (board) {
    return catalogService.normalizeForSearch(board && board.name) === normalizedSlug;
  }) || null;
}

function refreshAdminDataMiddleware(req, res, next) {
  catalogService
    .refreshAdminData()
    .catch(function (error) {
      console.error('Failed to refresh admin data:', error.message);
    })
    .finally(function () {
      next();
    });
}

function countObjectKeys(value) {
  if (!value || typeof value !== 'object') {
    return 0;
  }

  return Object.keys(value).length;
}

function buildDashboardStats(categoryBoards, adminData) {
  var boards = Array.isArray(categoryBoards) ? categoryBoards : [];
  var safeAdminData = adminData && typeof adminData === 'object' ? adminData : {};
  var totalCategories = boards.length;
  var totalProducts = boards.reduce(function (total, board) {
    return total + (Array.isArray(board && board.items) ? board.items.length : 0);
  }, 0);
  var emptyCategories = boards.reduce(function (total, board) {
    var itemCount = Array.isArray(board && board.items) ? board.items.length : 0;
    return total + (itemCount === 0 ? 1 : 0);
  }, 0);
  var averageProductsPerCategory = totalCategories > 0 ? (totalProducts / totalCategories) : 0;

  return {
    totalCategories: totalCategories,
    totalProducts: totalProducts,
    emptyCategories: emptyCategories,
    averageProductsPerCategory: Number(averageProductsPerCategory.toFixed(1)),
    adminOnlyCategories: Array.isArray(safeAdminData.categories) ? safeAdminData.categories.length : 0,
    adminOnlyProducts: Array.isArray(safeAdminData.products) ? safeAdminData.products.length : 0,
    priceOverrides: countObjectKeys(safeAdminData.priceOverrides),
    imageOverrides: countObjectKeys(safeAdminData.imageOverrides),
    productOverrides: countObjectKeys(safeAdminData.productOverrides),
    deletedProductIds: Array.isArray(safeAdminData.deletedProductIds) ? safeAdminData.deletedProductIds.length : 0,
    deletedCategoryNames: Array.isArray(safeAdminData.deletedCategoryNames) ? safeAdminData.deletedCategoryNames.length : 0,
  };
}

function buildRecentAdminProducts(adminData) {
  if (!adminData || !Array.isArray(adminData.products)) {
    return [];
  }

  return adminData.products
    .slice(-6)
    .reverse()
    .map(function (product) {
      return {
        id: catalogService.toTrimmedString(product.id),
        type: catalogService.toTrimmedString(product.type),
        name: catalogService.toTrimmedString(product.name),
        price: catalogService.toTrimmedString(product.price) || 'Contact for price',
        originalPrice: catalogService.toTrimmedString(product.originalPrice),
        discountPercent: catalogService.toTrimmedString(product.discountPercent),
        quantity: catalogService.toTrimmedString(product.quantity),
        image: catalogService.normalizeAssetPath(product.image),
      };
    });
}

function buildAdminProductOrderById(adminData) {
  var orderById = {};

  if (!adminData || !Array.isArray(adminData.products)) {
    return orderById;
  }

  adminData.products.forEach(function (product, index) {
    var productId = catalogService.toTrimmedString(product && product.id);

    if (!productId) {
      return;
    }

    // Higher index means added later; view uses this to show newest first.
    orderById[productId] = index + 1;
  });

  return orderById;
}

function buildAdminOrderAcceptedEmailText(orderRecord, adminMessage) {
  var productName = catalogService.toTrimmedString(orderRecord && orderRecord.productName) || 'Product';
  var productType = catalogService.toTrimmedString(orderRecord && orderRecord.productType) || 'Category';
  var quantity = Number(orderRecord && orderRecord.quantity);
  var safeQuantity = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
  var totalLabel = catalogService.toTrimmedString(orderRecord && orderRecord.totalLabel) || 'Contact for price';
  var messageText = catalogService.toTrimmedString(adminMessage);
  var lines = [];

  lines.push('Your order request has been accepted.');
  lines.push('');
  lines.push('Product: ' + productName);
  lines.push('Category: ' + productType);
  lines.push('Quantity: ' + safeQuantity);
  lines.push('Total: ' + totalLabel);

  if (messageText) {
    lines.push('');
    lines.push('Admin Message: ' + messageText);
  }

  lines.push('');
  lines.push('Our team will contact you soon.');

  return lines.join('\n');
}

function buildAdminOrderAcceptedEmailHtml(orderRecord, adminMessage) {
  var productName = catalogService.toTrimmedString(orderRecord && orderRecord.productName) || 'Product';
  var productType = catalogService.toTrimmedString(orderRecord && orderRecord.productType) || 'Category';
  var quantity = Number(orderRecord && orderRecord.quantity);
  var safeQuantity = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
  var totalLabel = catalogService.toTrimmedString(orderRecord && orderRecord.totalLabel) || 'Contact for price';
  var messageText = catalogService.toTrimmedString(adminMessage);
  var messageBlock = '';

  if (messageText) {
    messageBlock = '<p style="margin:0 0 10px;"><strong>Admin message:</strong> ' + escapeHtml(messageText) + '</p>';
  }

  return [
    '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a;">',
    '<h2 style="margin:0 0 10px;">Your order request has been accepted</h2>',
    '<p style="margin:0 0 10px;">Thank you for ordering with BhutanDevi Trade and Suppliers.</p>',
    '<p style="margin:0 0 8px;"><strong>Product:</strong> ' + escapeHtml(productName) + '</p>',
    '<p style="margin:0 0 8px;"><strong>Category:</strong> ' + escapeHtml(productType) + '</p>',
    '<p style="margin:0 0 8px;"><strong>Quantity:</strong> ' + escapeHtml(safeQuantity) + '</p>',
    '<p style="margin:0 0 10px;"><strong>Total:</strong> ' + escapeHtml(totalLabel) + '</p>',
    messageBlock,
    '<p style="margin:0;">Our team will contact you soon.</p>',
    '</div>',
  ].join('');
}

async function loadAdminOrdersForDashboard(options) {
  var config = options && typeof options === 'object' ? options : {};
  var requestedView = catalogService.normalizeForSearch(config.view);
  var requestedPage = parsePositiveInteger(config.page, 1);
  var requestedPageSize = parsePositiveInteger(config.pageSize, adminOrderRequestsPageSize);
  var safePageSize = Math.max(1, Math.min(requestedPageSize, adminOrderRequestsLimit));
  var resolvedView = 'pending';
  var page = 1;
  var totalPages = 1;
  var counts = {
    total: 0,
    pending: 0,
    accepted: 0,
  };
  var orders = [];
  var loadError = '';
  var selectedFilter = {
    adminStatus: { $ne: 'accepted' },
  };
  var selectedCount = 0;
  var skipCount = 0;

  try {
    if (!await ensureDatabaseConnection()) {
      return {
        orders: [],
        loadError: 'Order database is unavailable right now.',
        view: resolvedView,
        page: page,
        totalPages: totalPages,
        pageSize: safePageSize,
        counts: counts,
      };
    }

    counts.pending = await Order.countDocuments({ adminStatus: { $ne: 'accepted' } });
    counts.accepted = await Order.countDocuments({ adminStatus: 'accepted' });
    counts.total = counts.pending + counts.accepted;

    if (requestedView === 'pending' || requestedView === 'accepted') {
      resolvedView = requestedView;
    } else if (!counts.pending && counts.accepted) {
      resolvedView = 'accepted';
    }

    selectedFilter = resolvedView === 'accepted'
      ? { adminStatus: 'accepted' }
      : { adminStatus: { $ne: 'accepted' } };
    selectedCount = resolvedView === 'accepted' ? counts.accepted : counts.pending;
    totalPages = Math.max(1, Math.ceil(selectedCount / safePageSize));
    page = Math.min(requestedPage, totalPages);
    skipCount = Math.max(0, (page - 1) * safePageSize);

    orders = await Order.find(selectedFilter)
      .sort({ createdAt: -1 })
      .skip(skipCount)
      .limit(safePageSize)
      .lean();
  } catch (error) {
    console.error('Admin order requests load failed:', error.message);
    loadError = 'Could not load order requests right now.';
  }

  return {
    orders: orders,
    loadError: loadError,
    view: resolvedView,
    page: page,
    totalPages: totalPages,
    pageSize: safePageSize,
    counts: counts,
  };
}

function buildAdminOrderCounts(orderRows) {
  var rows = Array.isArray(orderRows) ? orderRows : [];
  var pendingOrderRequestsCount = rows.reduce(function (total, orderItem) {
    var orderStatus = catalogService.toTrimmedString(orderItem && orderItem.adminStatus).toLowerCase();
    return total + (orderStatus === 'accepted' ? 0 : 1);
  }, 0);
  var acceptedOrderRequestsCount = rows.reduce(function (total, orderItem) {
    var orderStatus = catalogService.toTrimmedString(orderItem && orderItem.adminStatus).toLowerCase();
    return total + (orderStatus === 'accepted' ? 1 : 0);
  }, 0);

  return {
    pending: pendingOrderRequestsCount,
    accepted: acceptedOrderRequestsCount,
  };
}

function renderAdminPage(req, res) {
  var catalog = catalogService.getCatalogContext();
  var status = catalogService.toTrimmedString(req.query.status);
  var error = catalogService.toTrimmedString(req.query.error);
  var productOverviewPage = parsePositiveInteger(req.query.productsPage, 1);
  var adminData = catalogService.getAdminData();
  var categoryBoards = catalogService.buildAdminCategoryBoards(
    catalog.categoryGroups,
    catalog.productSections,
    catalog.categoryKeywordMap
  );

  res.render('admin', {
    title: 'Admin Panel | BhutanDevi Trade and Suppliers',
    q: '',
    activeCategory: '',
    statusMessage: catalogService.getAdminStatusMessage(status),
    errorMessage: catalogService.getAdminErrorMessage(error),
    categoryBoards: categoryBoards,
    dashboardStats: buildDashboardStats(categoryBoards, adminData),
    recentAdminProducts: buildRecentAdminProducts(adminData),
    adminProductOrderById: buildAdminProductOrderById(adminData),
    productOverviewPage: productOverviewPage,
    productOverviewPageSize: adminProductOverviewPageSize,
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
}

async function renderAdminOrdersPage(req, res) {
  var catalog = catalogService.getCatalogContext();
  var status = catalogService.toTrimmedString(req.query.status);
  var error = catalogService.toTrimmedString(req.query.error);
  var orderView = catalogService.normalizeForSearch(req.query.view);
  var orderPage = parsePositiveInteger(req.query.page, 1);
  var adminOrdersData = await loadAdminOrdersForDashboard({
    view: orderView,
    page: orderPage,
    pageSize: adminOrderRequestsPageSize,
  });
  var adminOrderRequests = Array.isArray(adminOrdersData.orders) ? adminOrdersData.orders : [];
  var orderCounts = adminOrdersData && adminOrdersData.counts ? adminOrdersData.counts : { total: 0, pending: 0, accepted: 0 };

  return res.render('admin-orders', {
    title: 'Order Requests | Admin Panel | BhutanDevi Trade and Suppliers',
    q: '',
    activeCategory: '',
    statusMessage: catalogService.getAdminStatusMessage(status),
    errorMessage: catalogService.getAdminErrorMessage(error),
    adminOrderRequests: adminOrderRequests,
    adminOrderRequestsError: adminOrdersData.loadError || '',
    totalOrderRequestsCount: orderCounts.total,
    pendingOrderRequestsCount: orderCounts.pending,
    acceptedOrderRequestsCount: orderCounts.accepted,
    adminOrdersView: adminOrdersData.view || 'pending',
    adminOrdersPage: adminOrdersData.page || 1,
    adminOrdersTotalPages: adminOrdersData.totalPages || 1,
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
}

function renderAdminCategoryPage(req, res) {
  var categorySlug = catalogService.toTrimmedString(req.params.categorySlug);
  var catalog = catalogService.getCatalogContext();
  var status = catalogService.toTrimmedString(req.query.status);
  var error = catalogService.toTrimmedString(req.query.error);
  var categoryItemsPage = parsePositiveInteger(req.query.itemsPage, 1);
  var categoryBoards = catalogService.buildAdminCategoryBoards(
    catalog.categoryGroups,
    catalog.productSections,
    catalog.categoryKeywordMap
  );
  var categoryBoard = findCategoryBoardBySlug(categorySlug, categoryBoards);

  if (!categoryBoard) {
    return res.redirect(buildErrorRedirect(defaultAdminPath, 'category-not-found'));
  }

  return res.render('admin-category', {
    title: categoryBoard.name + ' | Admin Panel | BhutanDevi Trade and Suppliers',
    q: '',
    activeCategory: '',
    statusMessage: catalogService.getAdminStatusMessage(status),
    errorMessage: catalogService.getAdminErrorMessage(error),
    categoryBoard: categoryBoard,
    categoryBoards: categoryBoards,
    categoryPagePath: buildCategoryAdminPath(categoryBoard.name),
    categoryItemsPage: categoryItemsPage,
    categoryItemsPageSize: adminCategoryItemsPageSize,
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
}

async function saveProductPrice(req, res) {
  var productId = catalogService.toTrimmedString(req.body.productId);
  var parsedPrice = parseNonNegativeNumber(req.body.productPrice);
  var productPrice = Number.isFinite(parsedPrice) ? formatNprAmount(parsedPrice) : '';
  var catalog = catalogService.getCatalogContext();
  var adminData = catalogService.getAdminData();
  var redirectPath = getSafeRedirectPath(req, defaultAdminPath);

  if (!productId || !isValidEntityId(productId)) {
    return res.redirect(buildErrorRedirect(redirectPath, 'product-id-required'));
  }

  if (!hasValidPriceValue(req.body.productPrice)) {
    return res.redirect(buildErrorRedirect(redirectPath, 'product-price-required'));
  }

  if (!catalogService.findProductById(productId, catalog.productSections)) {
    return res.redirect(buildErrorRedirect(redirectPath, 'product-not-found'));
  }

  adminData.priceOverrides[productId] = productPrice;

  if (!await catalogService.saveAdminData()) {
    return res.redirect(buildErrorRedirect(redirectPath, 'save-failed'));
  }

  return res.redirect(buildStatusRedirect(redirectPath, 'price-saved'));
}

function saveProductImage(req, res) {
  catalogService.imageUpload.single('productImageFile')(req, res, async function (uploadError) {
    var redirectPath = getSafeRedirectPath(req, defaultAdminPath);

    if (uploadError) {
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        return res.redirect(buildErrorRedirect(redirectPath, 'image-too-large'));
      }

      if (uploadError.message === 'invalid-image-file') {
        return res.redirect(buildErrorRedirect(redirectPath, 'invalid-image-file'));
      }

      return res.redirect(buildErrorRedirect(redirectPath, 'save-failed'));
    }

    var productId = catalogService.toTrimmedString(req.body.productId);
    var uploadedImagePath = await catalogService.optimizeUploadedImage(req.file);
    var catalog = catalogService.getCatalogContext();
    var adminData = catalogService.getAdminData();

    if (!productId || !isValidEntityId(productId)) {
      return res.redirect(buildErrorRedirect(redirectPath, 'product-id-required'));
    }

    if (!uploadedImagePath) {
      return res.redirect(buildErrorRedirect(redirectPath, 'product-image-file-required'));
    }

    if (!catalogService.findProductById(productId, catalog.productSections)) {
      return res.redirect(buildErrorRedirect(redirectPath, 'product-not-found'));
    }

    adminData.imageOverrides[productId] = uploadedImagePath;

    if (!await catalogService.saveAdminData()) {
      return res.redirect(buildErrorRedirect(redirectPath, 'save-failed'));
    }

    return res.redirect(buildStatusRedirect(redirectPath, 'image-saved'));
  });
}

function editProduct(req, res) {
  catalogService.imageUpload.single('productImageFile')(req, res, async function (uploadError) {
    var redirectPath = getSafeRedirectPath(req, defaultAdminPath);

    if (uploadError) {
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        return res.redirect(buildErrorRedirect(redirectPath, 'image-too-large'));
      }

      if (uploadError.message === 'invalid-image-file') {
        return res.redirect(buildErrorRedirect(redirectPath, 'invalid-image-file'));
      }

      return res.redirect(buildErrorRedirect(redirectPath, 'save-failed'));
    }

    var productId = catalogService.toTrimmedString(req.body.productId);
    var productCategory = normalizeSingleLineText(req.body.productCategory);
    var productName = normalizeSingleLineText(req.body.productName);
    var rawProductSpec = normalizeMultilineText(req.body.productSpec);
    var productSpec = buildProductSpec(
      productCategory,
      rawProductSpec,
      req.body.productHelmetCoverage
    );
    var productPricing = resolveProductPricing(req.body.productPrice, req.body.productDiscountPercent);
    var productPrice = productPricing.price;
    var productQuantity = normalizeProductQuantity(req.body.productQuantity);
    var currentImagePath = catalogService.normalizeAssetPath(req.body.currentImagePath);
    var uploadedImagePath = await catalogService.optimizeUploadedImage(req.file);
    var catalog = catalogService.getCatalogContext();
    var productMatch = catalogService.findProductById(productId, catalog.productSections);
    var adminData = catalogService.getAdminData();
    var resolvedImagePath = '';

    if (!productId || !isValidEntityId(productId)) {
      return res.redirect(buildErrorRedirect(redirectPath, 'product-id-required'));
    }

    if (!productCategory || !isWithinLength(productCategory, maxCategoryNameLength)) {
      return res.redirect(buildErrorRedirect(redirectPath, 'product-category-required'));
    }

    if (!productName || !isWithinLength(productName, maxProductNameLength)) {
      return res.redirect(buildErrorRedirect(redirectPath, 'product-name-required'));
    }

    if (!hasValidPriceValue(req.body.productPrice) || productPricing.isPriceMissing) {
      return res.redirect(buildErrorRedirect(redirectPath, 'product-price-required'));
    }

    if (!isWithinLength(rawProductSpec, maxProductSpecLength)) {
      return res.redirect(buildErrorRedirect(redirectPath, 'invalid-input'));
    }

    if (catalogService.toTrimmedString(req.body.productQuantity) && !hasValidQuantityValue(req.body.productQuantity)) {
      return res.redirect(buildErrorRedirect(redirectPath, 'invalid-input'));
    }

    if (!productMatch) {
      return res.redirect(buildErrorRedirect(redirectPath, 'product-not-found'));
    }

    if (hasDuplicateProductName(productCategory, productName, catalog.productSections, productId)) {
      return res.redirect(buildErrorRedirect(redirectPath, 'duplicate-product'));
    }

    resolvedImagePath =
      uploadedImagePath ||
      currentImagePath ||
      catalogService.normalizeAssetPath(productMatch.item.image) ||
      catalogService.defaultProductImagePath;

    if (!adminData.productOverrides || typeof adminData.productOverrides !== 'object') {
      adminData.productOverrides = {};
    }

    adminData.productOverrides[productId] = {
      type: productCategory,
      name: productName,
      spec: productSpec,
      price: productPrice,
      originalPrice: productPricing.originalPrice,
      discountPercent: productPricing.discountPercent ? String(productPricing.discountPercent) : '',
      quantity: productQuantity,
      image: resolvedImagePath,
    };

    catalogService.upsertAdminCategory(productCategory, '', [productName]);

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

    if (!await catalogService.saveAdminData()) {
      return res.redirect(buildErrorRedirect(redirectPath, 'save-failed'));
    }

    return res.redirect(buildStatusRedirect(redirectPath, 'product-updated'));
  });
}

async function deleteProduct(req, res) {
  var productId = catalogService.toTrimmedString(req.body.productId);
  var catalog = catalogService.getCatalogContext();
  var productMatch = catalogService.findProductById(productId, catalog.productSections);
  var adminData = catalogService.getAdminData();
  var hasAdminProduct = false;
  var deletedProductNameKey = '';
  var deletedCategoryKey = '';
  var redirectPath = getSafeRedirectPath(req, defaultAdminPath);

  if (!productId || !isValidEntityId(productId)) {
    return res.redirect(buildErrorRedirect(redirectPath, 'product-id-required'));
  }

  if (!productMatch) {
    return res.redirect(buildErrorRedirect(redirectPath, 'product-not-found'));
  }

  deletedProductNameKey = catalogService.normalizeForSearch(productMatch.item.name);
  deletedCategoryKey = catalogService.normalizeForSearch(productMatch.item.type);

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
      adminData.deletedProductIds = catalogService.normalizeList(adminData.deletedProductIds);
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
      var categoryKey = catalogService.normalizeForSearch(category.name);
      if (deletedCategoryKey && categoryKey !== deletedCategoryKey) {
        return;
      }

      if (!Array.isArray(category.items)) {
        return;
      }

      category.items = category.items.filter(function (itemName) {
        return catalogService.normalizeForSearch(itemName) !== deletedProductNameKey;
      });
    });
  }

  if (!await catalogService.saveAdminData()) {
    return res.redirect(buildErrorRedirect(redirectPath, 'save-failed'));
  }

  return res.redirect(buildStatusRedirect(redirectPath, 'product-deleted'));
}

async function deleteCategory(req, res) {
  var categoryName = normalizeSingleLineText(req.body.categoryName);
  var catalog = catalogService.getCatalogContext();
  var categoryBoards = catalogService.buildAdminCategoryBoards(
    catalog.categoryGroups,
    catalog.productSections,
    catalog.categoryKeywordMap
  );
  var adminData = catalogService.getAdminData();
  var categoryKey = catalogService.normalizeForSearch(categoryName);
  var matchedBoard = null;
  var matchedCategoryName = '';
  var matchedCategoryKey = '';
  var deletedProductIdsByKey = Object.create(null);
  var deletedProductIds = [];
  var redirectPath = getSafeRedirectPath(req, defaultAdminPath);

  if (!categoryName || !isWithinLength(categoryName, maxCategoryNameLength)) {
    return res.redirect(buildErrorRedirect(redirectPath, 'category-name-required'));
  }

  matchedBoard = categoryBoards.find(function (board) {
    return catalogService.normalizeForSearch(board.name) === categoryKey;
  }) || null;

  if (!matchedBoard) {
    return res.redirect(buildErrorRedirect(redirectPath, 'category-not-found'));
  }

  matchedCategoryName = matchedBoard.name;
  matchedCategoryKey = catalogService.normalizeForSearch(matchedCategoryName);

  if (!Array.isArray(adminData.deletedCategoryNames)) {
    adminData.deletedCategoryNames = [];
  }

  if (!catalogService.isDeletedCategory(matchedCategoryName)) {
    adminData.deletedCategoryNames.push(matchedCategoryName);
    adminData.deletedCategoryNames = catalogService.normalizeList(adminData.deletedCategoryNames);
  }

  if (Array.isArray(adminData.categories)) {
    adminData.categories = adminData.categories.filter(function (category) {
      return catalogService.normalizeForSearch(category.name) !== matchedCategoryKey;
    });
  }

  (matchedBoard.items || []).forEach(function (item) {
    if (item && item.id) {
      deletedProductIdsByKey[item.id] = true;
    }
  });

  if (Array.isArray(adminData.products)) {
    adminData.products.forEach(function (product) {
      var productOverride = catalogService.getProductOverrideEntry(product.id);
      var effectiveCategoryName =
        catalogService.toTrimmedString(productOverride.type) ||
        catalogService.toTrimmedString(product.type);
      if (catalogService.normalizeForSearch(effectiveCategoryName) === matchedCategoryKey) {
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
    adminData.deletedProductIds = catalogService.normalizeList(adminData.deletedProductIds.concat(deletedProductIds));
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

  if (!await catalogService.saveAdminData()) {
    return res.redirect(buildErrorRedirect(redirectPath, 'save-failed'));
  }

  return res.redirect(buildStatusRedirect(defaultAdminPath, 'category-deleted'));
}

async function saveCategory(req, res) {
  var categoryName = normalizeSingleLineText(req.body.categoryName);
  var categoryDescription = normalizeMultilineText(req.body.categoryDescription);
  var parsedCategoryItems = catalogService.parseCommaSeparatedList(req.body.categoryItems);
  var categoryItems = sanitizeCategoryItems(req.body.categoryItems);
  var redirectPath = getSafeRedirectPath(req, defaultAdminPath);

  if (!categoryName) {
    return res.redirect(buildErrorRedirect(redirectPath, 'category-name-required'));
  }

  if (!isWithinLength(categoryName, maxCategoryNameLength) || !isWithinLength(categoryDescription, maxCategoryDescriptionLength)) {
    return res.redirect(buildErrorRedirect(redirectPath, 'invalid-input'));
  }

  if (parsedCategoryItems.length > maxCategoryItemsCount) {
    return res.redirect(buildErrorRedirect(redirectPath, 'invalid-input'));
  }

  catalogService.upsertAdminCategory(categoryName, categoryDescription, categoryItems);

  if (!await catalogService.saveAdminData()) {
    return res.redirect(buildErrorRedirect(redirectPath, 'save-failed'));
  }

  return res.redirect(buildStatusRedirect(redirectPath, 'category-saved'));
}

async function acceptOrderRequest(req, res) {
  var requestBody = req && req.body && typeof req.body === 'object' ? req.body : {};
  var orderId = catalogService.toTrimmedString(requestBody.orderId);
  var adminMessage = normalizeMultilineText(requestBody.adminMessage);
  var redirectPath = getSafeRedirectPath(req, defaultAdminOrdersPath);
  var hasMongoConfiguration = Boolean(String(process.env.MONGODB_URI || '').trim());
  var orderRecord = null;
  var orderStatus = '';
  var orderProductId = '';
  var orderQuantity = 1;
  var catalog = null;
  var productMatch = null;
  var availableStockQuantity = null;
  var nextStockQuantity = '';
  var adminData = null;
  var hasAdminProduct = false;
  var stockUpdated = false;
  var customerEmail = '';
  var emailSubject = '';
  var productName = '';
  var orderRecordId = '';

  if (!orderId) {
    return res.redirect(buildErrorRedirect(redirectPath, 'order-id-required'));
  }

  if (!/^[a-f0-9]{24}$/i.test(orderId)) {
    return res.redirect(buildErrorRedirect(redirectPath, 'order-not-found'));
  }

  if (adminMessage.length > maxAdminOrderMessageLength) {
    return res.redirect(buildErrorRedirect(redirectPath, 'invalid-input'));
  }

  try {
    if (!await ensureDatabaseConnection()) {
      return res.redirect(buildErrorRedirect(redirectPath, 'db-unavailable'));
    }

    orderRecord = await Order.findById(orderId);

    if (!orderRecord) {
      return res.redirect(buildErrorRedirect(redirectPath, 'order-not-found'));
    }

    orderStatus = catalogService.toTrimmedString(orderRecord.adminStatus).toLowerCase();
    if (orderStatus === 'accepted') {
      return res.redirect(buildStatusRedirect(redirectPath, 'order-accepted'));
    }

    orderProductId = catalogService.toTrimmedString(orderRecord.productId);
    orderQuantity = parsePositiveInteger(orderRecord.quantity, 1);

    if (orderProductId) {
      catalog = catalogService.getCatalogContext();
      productMatch = catalog && Array.isArray(catalog.productSections)
        ? catalogService.findProductById(orderProductId, catalog.productSections)
        : null;

      if (productMatch && productMatch.item) {
        availableStockQuantity = parseStoredStockQuantity(productMatch.item.quantity);

        if (availableStockQuantity !== null) {
          if (availableStockQuantity < 1) {
            return res.redirect(buildErrorRedirect(redirectPath, 'out-of-stock'));
          }

          if (orderQuantity > availableStockQuantity) {
            return res.redirect(buildErrorRedirect(redirectPath, 'insufficient-stock'));
          }

          nextStockQuantity = String(Math.max(availableStockQuantity - orderQuantity, 0));
          adminData = catalogService.getAdminData() || {};

          if (!Array.isArray(adminData.products)) {
            adminData.products = [];
          }

          adminData.products.forEach(function (product) {
            if (catalogService.toTrimmedString(product && product.id) !== orderProductId) {
              return;
            }

            product.quantity = nextStockQuantity;
            hasAdminProduct = true;
          });

          if (!adminData.productOverrides || typeof adminData.productOverrides !== 'object') {
            adminData.productOverrides = {};
          }

          if (
            adminData.productOverrides[orderProductId] &&
            typeof adminData.productOverrides[orderProductId] === 'object'
          ) {
            adminData.productOverrides[orderProductId].quantity = nextStockQuantity;
          } else if (!hasAdminProduct) {
            adminData.productOverrides[orderProductId] = { quantity: nextStockQuantity };
          }

          stockUpdated = true;
        }
      }
    }

    if (stockUpdated && !await catalogService.saveAdminData()) {
      if (hasMongoConfiguration && !await ensureDatabaseConnection()) {
        return res.redirect(buildErrorRedirect(redirectPath, 'db-unavailable'));
      }

      return res.redirect(buildErrorRedirect(redirectPath, 'save-failed'));
    }

    orderRecord.adminStatus = 'accepted';
    orderRecord.adminMessage = adminMessage;
    orderRecord.adminAcceptedAt = new Date();
    orderRecord.adminEmailNotificationSent = false;
    await orderRecord.save();

    orderRecordId = orderRecord && orderRecord._id ? String(orderRecord._id) : '';
    customerEmail = normalizeEmail(orderRecord.customerEmail);
    productName = catalogService.toTrimmedString(orderRecord.productName) || 'Product';
    emailSubject = 'Order accepted: ' + productName;

    if (customerEmail && isLikelyEmailAddress(customerEmail) && orderRecordId) {
      Promise.resolve().then(async function () {
        var sendResult = null;
        var acceptedOrderRecord = null;

        try {
          sendResult = await resendService.sendEmail({
            to: customerEmail,
            subject: emailSubject,
            text: buildAdminOrderAcceptedEmailText(orderRecord, adminMessage),
            html: buildAdminOrderAcceptedEmailHtml(orderRecord, adminMessage),
          });

          if (!sendResult.ok) {
            console.error('Order accepted email failed:', sendResult.errorCode || 'unknown');
            return;
          }

          acceptedOrderRecord = await Order.findById(orderRecordId);
          if (!acceptedOrderRecord) {
            return;
          }

          acceptedOrderRecord.adminEmailNotificationSent = true;
          await acceptedOrderRecord.save();
        } catch (emailError) {
          console.error('Order accepted email async failed:', emailError.message);
        }
      });
    }

    return res.redirect(buildStatusRedirect(redirectPath, 'order-accepted'));
  } catch (error) {
    console.error('Order accept action failed:', error.message);
    return res.redirect(buildErrorRedirect(redirectPath, 'save-failed'));
  }
}

async function deleteOrderRequest(req, res) {
  var requestBody = req && req.body && typeof req.body === 'object' ? req.body : {};
  var orderId = catalogService.toTrimmedString(requestBody.orderId);
  var redirectPath = getSafeRedirectPath(req, defaultAdminOrdersPath);
  var deletedOrder = null;

  if (!orderId) {
    return res.redirect(buildErrorRedirect(redirectPath, 'order-id-required'));
  }

  if (!/^[a-f0-9]{24}$/i.test(orderId)) {
    return res.redirect(buildErrorRedirect(redirectPath, 'order-not-found'));
  }

  try {
    if (!await ensureDatabaseConnection()) {
      return res.redirect(buildErrorRedirect(redirectPath, 'db-unavailable'));
    }

    deletedOrder = await Order.findByIdAndDelete(orderId);

    if (!deletedOrder) {
      return res.redirect(buildErrorRedirect(redirectPath, 'order-not-found'));
    }

    return res.redirect(buildStatusRedirect(redirectPath, 'order-deleted'));
  } catch (error) {
    console.error('Order delete action failed:', error.message);
    return res.redirect(buildErrorRedirect(redirectPath, 'save-failed'));
  }
}

function saveProduct(req, res) {
  catalogService.imageUpload.single('productImageFile')(req, res, async function (uploadError) {
    var redirectPath = getSafeRedirectPath(req, defaultAdminPath);
    var hasMongoConfiguration = Boolean(String(process.env.MONGODB_URI || '').trim());
    var hasDatabaseConnection = true;

    if (uploadError) {
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        return res.redirect(buildErrorRedirect(redirectPath, 'image-too-large'));
      }

      if (uploadError.message === 'invalid-image-file') {
        return res.redirect(buildErrorRedirect(redirectPath, 'invalid-image-file'));
      }

      return res.redirect(buildErrorRedirect(redirectPath, 'save-failed'));
    }

    if (hasMongoConfiguration) {
      hasDatabaseConnection = await ensureDatabaseConnection();
      if (!hasDatabaseConnection) {
        return res.redirect(buildErrorRedirect(redirectPath, 'db-unavailable'));
      }
    }

    var categoryName = normalizeSingleLineText(req.body.productCategory);
    var productName = normalizeSingleLineText(req.body.productName);
    var rawProductSpec = normalizeMultilineText(req.body.productSpec);
    var productSpec = buildProductSpec(
      categoryName,
      rawProductSpec,
      req.body.productHelmetCoverage
    );
    var productPricing = resolveProductPricing(req.body.productPrice, req.body.productDiscountPercent);
    var productPrice = productPricing.price || 'Contact for price';
    var productQuantity = normalizeProductQuantity(req.body.productQuantity);
    var uploadedImagePath = await catalogService.optimizeUploadedImage(req.file);
    var primaryImage = uploadedImagePath || '';
    var catalog = catalogService.getCatalogContext();
    var productId = catalogService.buildUniqueProductId(categoryName, productName, catalog.productSections);
    var adminData = catalogService.getAdminData();

    if (!categoryName || !isWithinLength(categoryName, maxCategoryNameLength)) {
      return res.redirect(buildErrorRedirect(redirectPath, 'product-category-required'));
    }

    if (!productName || !isWithinLength(productName, maxProductNameLength)) {
      return res.redirect(buildErrorRedirect(redirectPath, 'product-name-required'));
    }

    if (!hasValidPriceValue(req.body.productPrice) || productPricing.isPriceMissing) {
      return res.redirect(buildErrorRedirect(redirectPath, 'product-price-required'));
    }

    if (!isWithinLength(rawProductSpec, maxProductSpecLength)) {
      return res.redirect(buildErrorRedirect(redirectPath, 'invalid-input'));
    }

    if (!hasValidQuantityValue(req.body.productQuantity)) {
      return res.redirect(buildErrorRedirect(redirectPath, 'invalid-input'));
    }

    if (!uploadedImagePath) {
      return res.redirect(buildErrorRedirect(redirectPath, 'product-image-file-required'));
    }

    if (hasDuplicateProductName(categoryName, productName, catalog.productSections)) {
      return res.redirect(buildErrorRedirect(redirectPath, 'duplicate-product'));
    }

    catalogService.upsertAdminCategory(categoryName, '', [productName]);

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
      originalPrice: productPricing.originalPrice,
      discountPercent: productPricing.discountPercent ? String(productPricing.discountPercent) : '',
      quantity: productQuantity,
      image: primaryImage,
      images: catalogService.normalizeImageList([primaryImage], primaryImage),
    });

    if (!await catalogService.saveAdminData()) {
      if (hasMongoConfiguration) {
        hasDatabaseConnection = await ensureDatabaseConnection();
        if (!hasDatabaseConnection) {
          return res.redirect(buildErrorRedirect(redirectPath, 'db-unavailable'));
        }
      }
      return res.redirect(buildErrorRedirect(redirectPath, 'save-failed'));
    }

    return res.redirect(buildStatusRedirect(redirectPath, 'product-saved'));
  });
}

module.exports = {
  acceptOrderRequest: acceptOrderRequest,
  deleteOrderRequest: deleteOrderRequest,
  deleteCategory: deleteCategory,
  deleteProduct: deleteProduct,
  editProduct: editProduct,
  refreshAdminDataMiddleware: refreshAdminDataMiddleware,
  renderAdminCategoryPage: renderAdminCategoryPage,
  renderAdminOrdersPage: renderAdminOrdersPage,
  renderAdminPage: renderAdminPage,
  saveCategory: saveCategory,
  saveProduct: saveProduct,
  saveProductImage: saveProductImage,
  saveProductPrice: saveProductPrice,
};
