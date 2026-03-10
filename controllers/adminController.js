var mongoose = require('mongoose');
var fs = require('fs');
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
var parsedAdminRefreshCooldownMs = Number(process.env.ADMIN_DATA_REFRESH_COOLDOWN_MS);
var adminRefreshCooldownMs = Number.isFinite(parsedAdminRefreshCooldownMs) && parsedAdminRefreshCooldownMs >= 0
  ? Math.floor(parsedAdminRefreshCooldownMs)
  : 15000;
var isAdminRefreshInProgress = false;
var lastAdminRefreshAt = 0;
var adminMutationQueue = Promise.resolve();

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

function buildAdminProductsPagePath(page) {
  var parsedPage = Number(page);
  var safePage = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1;

  if (safePage <= 1) {
    return '/admin/products';
  }

  return '/admin/products?page=' + safePage;
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

function hasDuplicateCategoryName(categoryName, categoryBoards, originalCategoryName) {
  var categoryKey = catalogService.normalizeForSearch(categoryName);
  var originalCategoryKey = catalogService.normalizeForSearch(originalCategoryName);

  if (!categoryKey) {
    return false;
  }

  return (categoryBoards || []).some(function (board) {
    var boardKey = catalogService.normalizeForSearch(board && board.name);

    if (!boardKey || boardKey !== categoryKey) {
      return false;
    }

    if (originalCategoryKey && boardKey === originalCategoryKey) {
      return false;
    }

    return true;
  });
}

function buildAdminCategoryRecordsByKey(adminData) {
  var categoryRecordsByKey = Object.create(null);

  if (!adminData || !Array.isArray(adminData.categories)) {
    return categoryRecordsByKey;
  }

  adminData.categories.forEach(function (category) {
    var categoryName = normalizeSingleLineText(category && category.name);
    var categoryKey = toCategorySlug(categoryName);

    if (!categoryKey || categoryRecordsByKey[categoryKey]) {
      return;
    }

    categoryRecordsByKey[categoryKey] = {
      name: categoryName,
      description: normalizeMultilineText(category && category.description),
      items: sanitizeCategoryItems(category && category.items),
    };
  });

  return categoryRecordsByKey;
}

function resolveCategorySaveRedirectPath(categoryName, redirectPath, shouldReplaceCategoryItems) {
  var safeRedirectPath = catalogService.toTrimmedString(redirectPath) || defaultAdminPath;

  if (shouldReplaceCategoryItems && safeRedirectPath.indexOf('/admin/categories') === 0) {
    return buildCategoryAdminPath(categoryName);
  }

  return safeRedirectPath;
}

function isAjaxRequest(req) {
  var acceptHeader = String(req && req.headers ? req.headers.accept || '' : '').toLowerCase();
  var requestedWithHeader = String(req && req.headers ? req.headers['x-requested-with'] || '' : '');

  return Boolean(
    (req && req.xhr) ||
    requestedWithHeader === 'XMLHttpRequest' ||
    acceptHeader.indexOf('application/json') !== -1
  );
}

function runAdminMutation(task) {
  var queuedTask = adminMutationQueue.then(function () {
    return Promise.resolve().then(task);
  });

  adminMutationQueue = queuedTask.catch(function () {
    return undefined;
  });

  return queuedTask;
}

function removeProductNameFromAdminCategory(adminData, categoryName, productName) {
  var categoryKey = catalogService.normalizeForSearch(categoryName);
  var productNameKey = catalogService.normalizeForSearch(productName);

  if (!categoryKey || !productNameKey || !adminData || !Array.isArray(adminData.categories)) {
    return;
  }

  adminData.categories.forEach(function (category) {
    if (catalogService.normalizeForSearch(category && category.name) !== categoryKey) {
      return;
    }

    if (!Array.isArray(category.items)) {
      return;
    }

    category.items = category.items.filter(function (itemName) {
      return catalogService.normalizeForSearch(itemName) !== productNameKey;
    });
  });
}

function buildProductSpec(categoryName, rawSpec) {
  var specText = catalogService.toTrimmedString(rawSpec);
  if (/^n\/?a$/i.test(specText)) {
    return '';
  }

  return specText;
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

function findCategoryBoardByName(categoryName, categoryBoards) {
  var normalizedName = catalogService.normalizeForSearch(categoryName);

  if (!normalizedName) {
    return null;
  }

  return (categoryBoards || []).find(function (board) {
    return catalogService.normalizeForSearch(board && board.name) === normalizedName;
  }) || null;
}

function refreshAdminDataMiddleware(req, res, next) {
  var requestMethod = String(req && req.method ? req.method : '').toUpperCase();
  var now = Date.now();
  if (requestMethod && requestMethod !== 'GET' && requestMethod !== 'HEAD') {
    return next();
  }

  if (isAdminRefreshInProgress || ((now - lastAdminRefreshAt) < adminRefreshCooldownMs)) {
    return next();
  }

  isAdminRefreshInProgress = true;
  lastAdminRefreshAt = now;

  catalogService
    .refreshAdminData()
    .catch(function (error) {
      console.error('Failed to refresh admin data:', error.message);
    })
    .finally(function () {
      isAdminRefreshInProgress = false;
    });

  return next();
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

function buildAdminProductRows(categoryBoards, adminData) {
  var rows = [];
  var safeBoards = Array.isArray(categoryBoards) ? categoryBoards : [];
  var productOrderById = buildAdminProductOrderById(adminData);

  safeBoards.forEach(function (board) {
    var boardName = catalogService.toTrimmedString(board && board.name);
    var boardItems = Array.isArray(board && board.items) ? board.items : [];

    boardItems.forEach(function (item) {
      var productId = catalogService.toTrimmedString(item && item.id);

      if (!productId) {
        return;
      }

      rows.push({
        id: productId,
        categoryName: boardName,
        name: catalogService.toTrimmedString(item && item.name),
        spec: catalogService.toTrimmedString(item && item.spec),
        price: catalogService.toTrimmedString(item && item.price) || 'Contact for price',
        quantity: parseStoredStockQuantity(item && item.quantity),
        image: catalogService.normalizeAssetPath(item && item.image),
        addedOrder: Number(productOrderById[productId]) || 0,
      });
    });
  });

  rows.sort(function (left, right) {
    return (
      (Number(right.addedOrder) - Number(left.addedOrder)) ||
      String(left.categoryName || '').localeCompare(String(right.categoryName || '')) ||
      String(left.name || '').localeCompare(String(right.name || ''))
    );
  });

  return rows;
}

function paginateAdminProductRows(productRows, requestedPage, pageSize) {
  var rows = Array.isArray(productRows) ? productRows : [];
  var parsedPageSize = Number(pageSize);
  var safePageSize = Number.isFinite(parsedPageSize) && parsedPageSize > 0 ? Math.floor(parsedPageSize) : adminProductOverviewPageSize;
  var totalPages = Math.max(1, Math.ceil(rows.length / safePageSize));
  var parsedPage = Number(requestedPage);
  var safePage = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1;
  var startIndex = 0;

  if (safePage > totalPages) {
    safePage = totalPages;
  }

  startIndex = (safePage - 1) * safePageSize;

  return {
    rows: rows.slice(startIndex, startIndex + safePageSize),
    page: safePage,
    totalPages: totalPages,
    pageSize: safePageSize,
    totalCount: rows.length,
  };
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
    adminStatus: mongoose.trusted({ $ne: 'accepted' }),
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

    counts.pending = await Order.countDocuments({ adminStatus: mongoose.trusted({ $ne: 'accepted' }) });
    counts.accepted = await Order.countDocuments({ adminStatus: 'accepted' });
    counts.total = counts.pending + counts.accepted;

    if (requestedView === 'pending' || requestedView === 'accepted') {
      resolvedView = requestedView;
    } else if (!counts.pending && counts.accepted) {
      resolvedView = 'accepted';
    }

    selectedFilter = resolvedView === 'accepted'
      ? { adminStatus: 'accepted' }
      : { adminStatus: mongoose.trusted({ $ne: 'accepted' }) };
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
    adminCategoryRecords: buildAdminCategoryRecordsByKey(adminData),
    dashboardStats: buildDashboardStats(categoryBoards, adminData),
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
}

async function renderAdminProductsPage(req, res) {
  var catalog = catalogService.getCatalogContext();
  var status = catalogService.toTrimmedString(req.query.status);
  var error = catalogService.toTrimmedString(req.query.error);
  var requestedPage = parsePositiveInteger(req.query.page, 1);
  var adminData = catalogService.getAdminData();
  var categoryBoards = catalogService.buildAdminCategoryBoards(
    catalog.categoryGroups,
    catalog.productSections,
    catalog.categoryKeywordMap
  );
  var productRows = buildAdminProductRows(categoryBoards, adminData);
  // Sort product overview A -> Z by product name to match admin-category listing
  productRows.sort(function (a, b) {
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  var pagination = paginateAdminProductRows(productRows, requestedPage, adminProductOverviewPageSize);

  // Attach sold counts for products on the current page (sum of accepted orders)
  try {
    var pageRows = Array.isArray(pagination.rows) ? pagination.rows : [];
    var productIds = pageRows.map(function (r) { return catalogService.toTrimmedString(r && r.id); }).filter(Boolean);

    if (productIds.length && await ensureDatabaseConnection()) {
      var soldGroups = await Order.aggregate([
        { $match: { productId: { $in: productIds }, adminStatus: 'accepted' } },
        { $group: { _id: '$productId', sold: { $sum: '$quantity' } } },
      ]).allowDiskUse(true);

      var soldById = {};
      (soldGroups || []).forEach(function (grp) {
        if (grp && grp._id) {
          soldById[String(grp._id)] = Number.isFinite(Number(grp.sold)) ? Number(grp.sold) : 0;
        }
      });

      pageRows.forEach(function (r) {
        var pid = catalogService.toTrimmedString(r && r.id);
        r.sold = soldById[pid] || 0;
      });
    }
  } catch (err) {
    console.error('Failed to attach sold counts for admin products page:', err && err.message ? err.message : err);
  }

  return res.render('admin-products', {
    title: 'Products | Admin Panel | BhutanDevi Trade and Suppliers',
    statusMessage: catalogService.getAdminStatusMessage(status),
    errorMessage: catalogService.getAdminErrorMessage(error),
    productRows: pagination.rows,
    totalProductCount: pagination.totalCount,
    adminProductsPage: pagination.page,
    adminProductsTotalPages: pagination.totalPages,
    adminProductsPagePath: buildAdminProductsPagePath(pagination.page),
    dashboardStats: buildDashboardStats(categoryBoards, adminData),
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

async function renderAdminCategoryPage(req, res) {
  var categorySlug = catalogService.toTrimmedString(req.params.categorySlug);
  var catalog = catalogService.getCatalogContext();
  var status = catalogService.toTrimmedString(req.query.status);
  var error = catalogService.toTrimmedString(req.query.error);
  var categoryItemsPage = parsePositiveInteger(req.query.itemsPage, 1);
  var adminData = catalogService.getAdminData() || {};
  var categoryBoards = catalogService.buildAdminCategoryBoards(
    catalog.categoryGroups,
    catalog.productSections,
    catalog.categoryKeywordMap
  );
  var categoryBoard = findCategoryBoardBySlug(categorySlug, categoryBoards);
  var categoryRecord = null;

  if (!categoryBoard) {
    return res.redirect(buildErrorRedirect(defaultAdminPath, 'category-not-found'));
  }

  if (Array.isArray(adminData.categories)) {
    categoryRecord = adminData.categories.find(function (category) {
      return catalogService.normalizeForSearch(category && category.name) === catalogService.normalizeForSearch(categoryBoard.name);
    }) || null;
  }

  // Attach sold counts (sum of quantities for accepted orders) to each product item when possible.
  try {
    var productIds = Array.isArray(categoryBoard.items) ? categoryBoard.items.map(function (it) { return catalogService.toTrimmedString(it && it.id); }).filter(Boolean) : [];

    if (productIds.length && await ensureDatabaseConnection()) {
      var soldGroups = await Order.aggregate([
        { $match: { productId: { $in: productIds }, adminStatus: 'accepted' } },
        { $group: { _id: '$productId', sold: { $sum: '$quantity' } } },
      ]).allowDiskUse(true);

      var soldById = {};
      (soldGroups || []).forEach(function (grp) {
        if (grp && grp._id) {
          soldById[String(grp._id)] = Number.isFinite(Number(grp.sold)) ? Number(grp.sold) : 0;
        }
      });

      (categoryBoard.items || []).forEach(function (it) {
        var pid = catalogService.toTrimmedString(it && it.id);
        it.sold = soldById[pid] || 0;
      });
    }
  } catch (err) {
    console.error('Failed to attach sold counts for admin category page:', err && err.message ? err.message : err);
  }

  return res.render('admin-category', {
    title: categoryBoard.name + ' | Admin Panel | BhutanDevi Trade and Suppliers',
    q: '',
    activeCategory: '',
    statusMessage: catalogService.getAdminStatusMessage(status),
    errorMessage: catalogService.getAdminErrorMessage(error),
    categoryBoard: categoryBoard,
    categoryRecord: categoryRecord,
    categoryBoards: categoryBoards,
    categoryPagePath: buildCategoryAdminPath(categoryBoard.name),
    categoryItemsPage: categoryItemsPage,
    categoryItemsPageSize: adminCategoryItemsPageSize,
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
}

function redirectAdminCategoryRoot(req, res) {
  return res.redirect(defaultAdminPath);
}

async function saveProductPrice(req, res) {
  var productId = catalogService.toTrimmedString(req.body.productId);
  var parsedPrice = parseNonNegativeNumber(req.body.productPrice);
  var productPrice = Number.isFinite(parsedPrice) ? formatNprAmount(parsedPrice) : '';
  var redirectPath = getSafeRedirectPath(req, defaultAdminPath);
  var hasMongoConfiguration = Boolean(String(process.env.MONGODB_URI || '').trim());
  var isAjax = isAjaxRequest(req);
  var mutationResult = null;

  if (hasMongoConfiguration && !await ensureDatabaseConnection()) {
    if (isAjax) {
      return res.status(503).json({ success: false, error: 'db-unavailable', message: 'Database unavailable' });
    }
    return res.redirect(buildErrorRedirect(redirectPath, 'db-unavailable'));
  }

  if (!productId || !isValidEntityId(productId)) {
    if (isAjax) {
      return res.status(400).json({ success: false, error: 'product-id-required', message: 'Product ID required' });
    }
    return res.redirect(buildErrorRedirect(redirectPath, 'product-id-required'));
  }

  if (!hasValidPriceValue(req.body.productPrice)) {
    if (isAjax) {
      return res.status(400).json({ success: false, error: 'product-price-required', message: 'Valid price required' });
    }
    return res.redirect(buildErrorRedirect(redirectPath, 'product-price-required'));
  }

  mutationResult = await runAdminMutation(async function () {
    var latestCatalog = catalogService.getCatalogContext();
    var latestAdminData = catalogService.getAdminData();

    if (!catalogService.findProductById(productId, latestCatalog.productSections)) {
      return {
        ok: false,
        errorCode: 'product-not-found',
        message: 'Product not found',
        statusCode: 404,
      };
    }

    if (!latestAdminData.priceOverrides || typeof latestAdminData.priceOverrides !== 'object') {
      latestAdminData.priceOverrides = {};
    }

    latestAdminData.priceOverrides[productId] = productPrice;

    if (!await catalogService.saveAdminData()) {
      return {
        ok: false,
        errorCode: 'save-failed',
        message: 'Failed to save price',
        statusCode: 500,
      };
    }

    return {
      ok: true,
    };
  });

  if (!mutationResult || !mutationResult.ok) {
    if (isAjax) {
      return res.status(mutationResult && mutationResult.statusCode ? mutationResult.statusCode : 500).json({
        success: false,
        error: mutationResult && mutationResult.errorCode ? mutationResult.errorCode : 'save-failed',
        message: mutationResult && mutationResult.message ? mutationResult.message : 'Failed to save price',
      });
    }
    return res.redirect(buildErrorRedirect(redirectPath, mutationResult && mutationResult.errorCode ? mutationResult.errorCode : 'save-failed'));
  }

  if (isAjax) {
    return res.json({ success: true, message: 'Price saved successfully', price: productPrice });
  }
  return res.redirect(buildStatusRedirect(redirectPath, 'price-saved'));
}

function saveProductImage(req, res) {
  catalogService.imageUpload.single('productImageFile')(req, res, async function (uploadError) {
    var redirectPath = getSafeRedirectPath(req, defaultAdminPath);
    var hasMongoConfiguration = Boolean(String(process.env.MONGODB_URI || '').trim());
    var isAjax = isAjaxRequest(req);
    var mutationResult = null;

    if (uploadError) {
      var errorCode = 'save-failed';
      var errorMessage = 'Save failed';
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        errorCode = 'image-too-large';
        errorMessage = 'Image too large';
      } else if (uploadError.message === 'invalid-image-file') {
        errorCode = 'invalid-image-file';
        errorMessage = 'Invalid image file';
      }
      if (isAjax) {
        return res.status(400).json({ success: false, error: errorCode, message: errorMessage });
      }
      return res.redirect(buildErrorRedirect(redirectPath, errorCode));
    }

    if (!req.file) {
      if (isAjax) {
        return res.status(400).json({ success: false, error: 'product-image-file-required', message: 'Image file required' });
      }
      return res.redirect(buildErrorRedirect(redirectPath, 'product-image-file-required'));
    }

    if (hasMongoConfiguration && !await ensureDatabaseConnection()) {
      if (isAjax) {
        return res.status(503).json({ success: false, error: 'db-unavailable', message: 'Database unavailable' });
      }
      return res.redirect(buildErrorRedirect(redirectPath, 'db-unavailable'));
    }

    var productId = catalogService.toTrimmedString(req.body.productId);
    var uploadedImagePath = await catalogService.optimizeUploadedImage(req.file);

    if (!productId || !isValidEntityId(productId)) {
      if (isAjax) {
        return res.status(400).json({ success: false, error: 'product-id-required', message: 'Product ID required' });
      }
      return res.redirect(buildErrorRedirect(redirectPath, 'product-id-required'));
    }

    if (!uploadedImagePath) {
      if (isAjax) {
        return res.status(500).json({ success: false, error: 'cloudinary-upload-failed', message: 'Image upload failed' });
      }
      return res.redirect(buildErrorRedirect(redirectPath, 'cloudinary-upload-failed'));
    }

    mutationResult = await runAdminMutation(async function () {
      var latestCatalog = catalogService.getCatalogContext();
      var latestAdminData = catalogService.getAdminData();

      if (!catalogService.findProductById(productId, latestCatalog.productSections)) {
        return {
          ok: false,
          errorCode: 'product-not-found',
          message: 'Product not found',
          statusCode: 404,
        };
      }

      if (!latestAdminData.imageOverrides || typeof latestAdminData.imageOverrides !== 'object') {
        latestAdminData.imageOverrides = {};
      }

      latestAdminData.imageOverrides[productId] = uploadedImagePath;

      if (!await catalogService.saveAdminData()) {
        return {
          ok: false,
          errorCode: 'save-failed',
          message: 'Failed to save image',
          statusCode: 500,
        };
      }

      return {
        ok: true,
      };
    });

    if (!mutationResult || !mutationResult.ok) {
      if (isAjax) {
        return res.status(mutationResult && mutationResult.statusCode ? mutationResult.statusCode : 500).json({
          success: false,
          error: mutationResult && mutationResult.errorCode ? mutationResult.errorCode : 'save-failed',
          message: mutationResult && mutationResult.message ? mutationResult.message : 'Failed to save image',
        });
      }
      return res.redirect(buildErrorRedirect(redirectPath, mutationResult && mutationResult.errorCode ? mutationResult.errorCode : 'save-failed'));
    }

    if (isAjax) {
      return res.json({ success: true, message: 'Image saved successfully', image: uploadedImagePath });
    }
    return res.redirect(buildStatusRedirect(redirectPath, 'image-saved'));
  });
}

function editProduct(req, res) {
  catalogService.imageUpload.single('productImageFile')(req, res, async function (uploadError) {
    var redirectPath = getSafeRedirectPath(req, defaultAdminPath);
    var hasMongoConfiguration = Boolean(String(process.env.MONGODB_URI || '').trim());
    var isAjax = isAjaxRequest(req);
    var mutationResult = null;

    function sendErrorResponse(errorCode, message, statusCode) {
      if (isAjax) {
        return res.status(statusCode || 400).json({ success: false, error: errorCode, message: message });
      }
      return res.redirect(buildErrorRedirect(redirectPath, errorCode));
    }

    if (uploadError) {
      var errorCode = 'save-failed';
      var errorMessage = 'Save failed';
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        errorCode = 'image-too-large';
        errorMessage = 'Image too large';
      } else if (uploadError.message === 'invalid-image-file') {
        errorCode = 'invalid-image-file';
        errorMessage = 'Invalid image file';
      }
      return sendErrorResponse(errorCode, errorMessage, 400);
    }

    if (hasMongoConfiguration && !await ensureDatabaseConnection()) {
      return sendErrorResponse('db-unavailable', 'Database unavailable', 503);
    }

    var productId = catalogService.toTrimmedString(req.body.productId);
    var requestedProductCategory = normalizeSingleLineText(req.body.productCategory);
    var productName = normalizeSingleLineText(req.body.productName);
    var rawProductSpec = normalizeMultilineText(req.body.productSpec);
    var productSpec = buildProductSpec(requestedProductCategory, rawProductSpec);
    var productPricing = resolveProductPricing(req.body.productPrice, req.body.productDiscountPercent);
    var productPrice = productPricing.price;
    var productQuantity = normalizeProductQuantity(req.body.productQuantity);
    var currentImagePath = catalogService.normalizeAssetPath(req.body.currentImagePath);
    var uploadedImagePath = '';

    if (req.file) {
      uploadedImagePath = await catalogService.optimizeUploadedImage(req.file);
      if (!uploadedImagePath) {
        return sendErrorResponse('cloudinary-upload-failed', 'Image upload failed', 500);
      }
    }

    if (!productId || !isValidEntityId(productId)) {
      return sendErrorResponse('product-id-required', 'Product ID required', 400);
    }

    if (!requestedProductCategory || !isWithinLength(requestedProductCategory, maxCategoryNameLength)) {
      return sendErrorResponse('product-category-required', 'Product category required', 400);
    }

    if (!productName || !isWithinLength(productName, maxProductNameLength)) {
      return sendErrorResponse('product-name-required', 'Product name required', 400);
    }

    if (!hasValidPriceValue(req.body.productPrice) || productPricing.isPriceMissing) {
      return sendErrorResponse('product-price-required', 'Valid price required', 400);
    }

    if (!isWithinLength(rawProductSpec, maxProductSpecLength)) {
      return sendErrorResponse('invalid-input', 'Invalid input', 400);
    }

    if (catalogService.toTrimmedString(req.body.productQuantity) && !hasValidQuantityValue(req.body.productQuantity)) {
      return sendErrorResponse('invalid-input', 'Invalid quantity', 400);
    }

    mutationResult = await runAdminMutation(async function () {
      var latestCatalog = catalogService.getCatalogContext();
      var latestProductMatch = catalogService.findProductById(productId, latestCatalog.productSections);
      var latestCategoryBoards = catalogService.buildAdminCategoryBoards(
        latestCatalog.categoryGroups,
        latestCatalog.productSections,
        latestCatalog.categoryKeywordMap
      );
      var matchedCategoryBoard = findCategoryBoardByName(requestedProductCategory, latestCategoryBoards);
      var adminData = catalogService.getAdminData();
      var resolvedImagePath = '';
      var resolvedCategoryName = '';
      var previousCategoryName = '';
      var previousProductName = '';
      var updatedProduct = null;
      var hasAdminProductEntry = false;

      if (!latestProductMatch || !latestProductMatch.item) {
        return {
          ok: false,
          errorCode: 'product-not-found',
          message: 'Product not found',
          statusCode: 404,
        };
      }

      if (!matchedCategoryBoard) {
        matchedCategoryBoard = findCategoryBoardByName(latestProductMatch.item.type, latestCategoryBoards);
      }

      if (!matchedCategoryBoard) {
        return {
          ok: false,
          errorCode: 'category-not-found',
          message: 'Category not found',
          statusCode: 404,
        };
      }

      resolvedCategoryName = matchedCategoryBoard.name;
      previousCategoryName = normalizeSingleLineText(latestProductMatch.item.type);
      previousProductName = normalizeSingleLineText(latestProductMatch.item.name);

      if (hasDuplicateProductName(resolvedCategoryName, productName, latestCatalog.productSections, productId)) {
        return {
          ok: false,
          errorCode: 'duplicate-product',
          message: 'Product already exists',
          statusCode: 409,
        };
      }

      resolvedImagePath =
        uploadedImagePath ||
        currentImagePath ||
        catalogService.normalizeAssetPath(latestProductMatch.item.image);

      if (!Array.isArray(adminData.products)) {
        adminData.products = [];
      }

      if (!adminData.productOverrides || typeof adminData.productOverrides !== 'object') {
        adminData.productOverrides = {};
      }

      updatedProduct = {
        type: resolvedCategoryName,
        name: productName,
        spec: productSpec,
        price: productPrice,
        originalPrice: productPricing.originalPrice,
        discountPercent: productPricing.discountPercent ? String(productPricing.discountPercent) : '',
        quantity: productQuantity,
        image: resolvedImagePath,
      };

      adminData.products.forEach(function (product) {
        if (catalogService.toTrimmedString(product && product.id) !== productId) {
          return;
        }

        product.type = updatedProduct.type;
        product.name = updatedProduct.name;
        product.spec = updatedProduct.spec;
        product.price = updatedProduct.price;
        product.originalPrice = updatedProduct.originalPrice;
        product.discountPercent = updatedProduct.discountPercent;
        product.quantity = updatedProduct.quantity;
        product.image = updatedProduct.image;
        product.images = catalogService.normalizeImageList([updatedProduct.image], updatedProduct.image);
        hasAdminProductEntry = true;
      });

      if (hasAdminProductEntry) {
        delete adminData.productOverrides[productId];
      } else {
        adminData.productOverrides[productId] = updatedProduct;
      }

      catalogService.upsertAdminCategory(resolvedCategoryName, '', [productName]);

      if (
        previousCategoryName &&
        previousProductName &&
        (
          catalogService.normalizeForSearch(previousCategoryName) !== catalogService.normalizeForSearch(resolvedCategoryName) ||
          catalogService.normalizeForSearch(previousProductName) !== catalogService.normalizeForSearch(productName)
        )
      ) {
        removeProductNameFromAdminCategory(adminData, previousCategoryName, previousProductName);
      }

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
        return {
          ok: false,
          errorCode: 'save-failed',
          message: 'Failed to update product',
          statusCode: 500,
        };
      }

      return {
        ok: true,
        productId: productId,
        product: updatedProduct,
      };
    });

    if (!mutationResult || !mutationResult.ok) {
      if (uploadedImagePath) {
        await catalogService.cleanupLocalImageAsset(uploadedImagePath);
      }

      return sendErrorResponse(
        mutationResult && mutationResult.errorCode ? mutationResult.errorCode : 'save-failed',
        mutationResult && mutationResult.message ? mutationResult.message : 'Failed to update product',
        mutationResult && mutationResult.statusCode ? mutationResult.statusCode : 500
      );
    }

    if (isAjax) {
      return res.json({
        success: true,
        message: 'Product updated successfully',
        productId: mutationResult.productId,
        product: mutationResult.product,
      });
    }
    return res.redirect(buildStatusRedirect(redirectPath, 'product-updated'));
  });
}

async function deleteProduct(req, res) {
  var productId = catalogService.toTrimmedString(req.body.productId);
  var redirectPath = getSafeRedirectPath(req, defaultAdminPath);
  var hasMongoConfiguration = Boolean(String(process.env.MONGODB_URI || '').trim());
  var isAjax = isAjaxRequest(req);
  var mutationResult = null;

  if (hasMongoConfiguration && !await ensureDatabaseConnection()) {
    if (isAjax) {
      return res.status(503).json({ success: false, error: 'db-unavailable', message: 'Database unavailable' });
    }
    return res.redirect(buildErrorRedirect(redirectPath, 'db-unavailable'));
  }

  if (!productId || !isValidEntityId(productId)) {
    if (isAjax) {
      return res.status(400).json({ success: false, error: 'product-id-required', message: 'Product ID required' });
    }
    return res.redirect(buildErrorRedirect(redirectPath, 'product-id-required'));
  }

  mutationResult = await runAdminMutation(async function () {
    var latestCatalog = catalogService.getCatalogContext();
    var latestProductMatch = catalogService.findProductById(productId, latestCatalog.productSections);
    var adminData = catalogService.getAdminData();
    var hasAdminProduct = false;
    var deletedProductNameKey = '';
    var deletedCategoryKey = '';
    var nextAdminProducts = [];

    if (!latestProductMatch || !latestProductMatch.item) {
      return {
        ok: false,
        errorCode: 'product-not-found',
        message: 'Product not found',
        statusCode: 404,
      };
    }

    deletedProductNameKey = catalogService.normalizeForSearch(latestProductMatch.item.name);
    deletedCategoryKey = catalogService.normalizeForSearch(latestProductMatch.item.type);

    if (Array.isArray(adminData.products)) {
      adminData.products.forEach(function (product) {
        if (catalogService.toTrimmedString(product && product.id) === productId) {
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
        var categoryKey = catalogService.normalizeForSearch(category && category.name);
        if (deletedCategoryKey && categoryKey !== deletedCategoryKey) {
          return;
        }

        if (!Array.isArray(category && category.items)) {
          return;
        }

        category.items = category.items.filter(function (itemName) {
          return catalogService.normalizeForSearch(itemName) !== deletedProductNameKey;
        });
      });
    }

    if (!await catalogService.saveAdminData()) {
      return {
        ok: false,
        errorCode: 'save-failed',
        message: 'Failed to delete product',
        statusCode: 500,
      };
    }

    return {
      ok: true,
      productId: productId,
    };
  });

  if (!mutationResult || !mutationResult.ok) {
    if (isAjax) {
      return res.status(mutationResult && mutationResult.statusCode ? mutationResult.statusCode : 500).json({
        success: false,
        error: mutationResult && mutationResult.errorCode ? mutationResult.errorCode : 'save-failed',
        message: mutationResult && mutationResult.message ? mutationResult.message : 'Failed to delete product',
      });
    }
    return res.redirect(buildErrorRedirect(redirectPath, mutationResult && mutationResult.errorCode ? mutationResult.errorCode : 'save-failed'));
  }

  if (isAjax) {
    return res.json({ success: true, message: 'Product deleted successfully', productId: mutationResult.productId });
  }
  return res.redirect(buildStatusRedirect(redirectPath, 'product-deleted'));
}

async function deleteCategory(req, res) {
  var categoryName = normalizeSingleLineText(req.body.categoryName);
  var categoryKey = catalogService.normalizeForSearch(categoryName);
  var redirectPath = getSafeRedirectPath(req, defaultAdminPath);
  var hasMongoConfiguration = Boolean(String(process.env.MONGODB_URI || '').trim());
  var isAjax = isAjaxRequest(req);
  var mutationResult = null;

  if (hasMongoConfiguration && !await ensureDatabaseConnection()) {
    if (isAjax) {
      return res.status(503).json({ success: false, error: 'db-unavailable', message: 'Database unavailable' });
    }
    return res.redirect(buildErrorRedirect(redirectPath, 'db-unavailable'));
  }

  if (!categoryName || !isWithinLength(categoryName, maxCategoryNameLength)) {
    if (isAjax) {
      return res.status(400).json({ success: false, error: 'category-name-required', message: 'Category name required' });
    }
    return res.redirect(buildErrorRedirect(redirectPath, 'category-name-required'));
  }

  mutationResult = await runAdminMutation(async function () {
    var latestCatalog = catalogService.getCatalogContext();
    var latestCategoryBoards = catalogService.buildAdminCategoryBoards(
      latestCatalog.categoryGroups,
      latestCatalog.productSections,
      latestCatalog.categoryKeywordMap
    );
    var adminData = catalogService.getAdminData();
    var matchedBoard = latestCategoryBoards.find(function (board) {
      return catalogService.normalizeForSearch(board && board.name) === categoryKey;
    }) || null;
    var matchedCategoryName = '';
    var matchedCategoryKey = '';
    var deletedProductIdsByKey = Object.create(null);
    var deletedProductIds = [];

    if (!matchedBoard) {
      return {
        ok: false,
        errorCode: 'category-not-found',
        message: 'Category not found',
        statusCode: 404,
      };
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
        return catalogService.normalizeForSearch(category && category.name) !== matchedCategoryKey;
      });
    }

    (matchedBoard.items || []).forEach(function (item) {
      if (item && item.id) {
        deletedProductIdsByKey[item.id] = true;
      }
    });

    if (Array.isArray(adminData.products)) {
      adminData.products.forEach(function (product) {
        var productOverride = catalogService.getProductOverrideEntry(product && product.id);
        var effectiveCategoryName =
          catalogService.toTrimmedString(productOverride.type) ||
          catalogService.toTrimmedString(product && product.type);

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
      return {
        ok: false,
        errorCode: 'save-failed',
        message: 'Failed to delete category',
        statusCode: 500,
      };
    }

    return {
      ok: true,
      categoryName: matchedCategoryName,
    };
  });

  if (!mutationResult || !mutationResult.ok) {
    if (isAjax) {
      return res.status(mutationResult && mutationResult.statusCode ? mutationResult.statusCode : 500).json({
        success: false,
        error: mutationResult && mutationResult.errorCode ? mutationResult.errorCode : 'save-failed',
        message: mutationResult && mutationResult.message ? mutationResult.message : 'Failed to delete category',
      });
    }
    return res.redirect(buildErrorRedirect(redirectPath, mutationResult && mutationResult.errorCode ? mutationResult.errorCode : 'save-failed'));
  }

  if (isAjax) {
    return res.json({ success: true, message: 'Category deleted successfully', categoryName: mutationResult.categoryName });
  }
  return res.redirect(buildStatusRedirect(defaultAdminPath, 'category-deleted'));
}

async function saveCategory(req, res) {
  var requestBody = req && req.body && typeof req.body === 'object' ? req.body : {};
  var categoryName = normalizeSingleLineText(req.body.categoryName);
  var originalCategoryName = normalizeSingleLineText(req.body.originalCategoryName);
  var categoryDescription = normalizeMultilineText(req.body.categoryDescription);
  var parsedCategoryItems = catalogService.parseCommaSeparatedList(req.body.categoryItems);
  var categoryItems = sanitizeCategoryItems(req.body.categoryItems);
  var shouldReplaceCategoryItems = /^(1|true|yes|on)$/i.test(catalogService.toTrimmedString(req.body.replaceCategoryItems));
  var shouldUpdateDescription = Object.prototype.hasOwnProperty.call(requestBody, 'categoryDescription');
  var redirectPath = getSafeRedirectPath(req, defaultAdminPath);
  var hasMongoConfiguration = Boolean(String(process.env.MONGODB_URI || '').trim());
  var isAjax = isAjaxRequest(req);
  var mutationResult = null;
  var successRedirectPath = redirectPath;

  if (hasMongoConfiguration && !await ensureDatabaseConnection()) {
    if (isAjax) {
      return res.status(503).json({ success: false, error: 'db-unavailable', message: 'Database unavailable' });
    }
    return res.redirect(buildErrorRedirect(redirectPath, 'db-unavailable'));
  }

  if (!categoryName) {
    if (isAjax) {
      return res.status(400).json({ success: false, error: 'category-name-required', message: 'Category name required' });
    }
    return res.redirect(buildErrorRedirect(redirectPath, 'category-name-required'));
  }

  if (
    !isWithinLength(categoryName, maxCategoryNameLength) ||
    !isWithinLength(originalCategoryName, maxCategoryNameLength) ||
    !isWithinLength(categoryDescription, maxCategoryDescriptionLength)
  ) {
    if (isAjax) {
      return res.status(400).json({ success: false, error: 'invalid-input', message: 'Invalid input' });
    }
    return res.redirect(buildErrorRedirect(redirectPath, 'invalid-input'));
  }

  if (parsedCategoryItems.length > maxCategoryItemsCount) {
    if (isAjax) {
      return res.status(400).json({ success: false, error: 'invalid-input', message: 'Too many items' });
    }
    return res.redirect(buildErrorRedirect(redirectPath, 'invalid-input'));
  }

  mutationResult = await runAdminMutation(async function () {
    var latestCatalog = catalogService.getCatalogContext();
    var latestCategoryBoards = catalogService.buildAdminCategoryBoards(
      latestCatalog.categoryGroups,
      latestCatalog.productSections,
      latestCatalog.categoryKeywordMap
    );
    var matchedOriginalCategory = null;
    var redirectCategorySlug = '';
    var resolvedOriginalCategoryName = originalCategoryName;

    if (resolvedOriginalCategoryName) {
      matchedOriginalCategory = findCategoryBoardByName(resolvedOriginalCategoryName, latestCategoryBoards);

      if (!matchedOriginalCategory) {
        redirectCategorySlug = catalogService.toTrimmedString(redirectPath).replace(/^\/admin\/categories\/([^/?#]+).*$/i, '$1');
        if (redirectCategorySlug && redirectCategorySlug !== redirectPath) {
          try {
            matchedOriginalCategory = findCategoryBoardBySlug(decodeURIComponent(redirectCategorySlug), latestCategoryBoards);
          } catch (decodeError) {
            matchedOriginalCategory = findCategoryBoardBySlug(redirectCategorySlug, latestCategoryBoards);
          }
        }
      }

      resolvedOriginalCategoryName = matchedOriginalCategory ? matchedOriginalCategory.name : '';
    }

    if (hasDuplicateCategoryName(categoryName, latestCategoryBoards, resolvedOriginalCategoryName)) {
      return {
        ok: false,
        errorCode: 'duplicate-category',
        message: 'Category already exists',
        statusCode: 409,
      };
    }

    catalogService.upsertAdminCategory(
      categoryName,
      categoryDescription,
      categoryItems,
      {
        originalName: resolvedOriginalCategoryName,
        updateDescription: shouldUpdateDescription,
        replaceItems: shouldReplaceCategoryItems,
      }
    );

    if (!await catalogService.saveAdminData()) {
      return {
        ok: false,
        errorCode: 'save-failed',
        message: 'Failed to save category',
        statusCode: 500,
      };
    }

    return {
      ok: true,
      categoryName: categoryName,
      originalCategoryName: resolvedOriginalCategoryName,
      categoryItems: categoryItems,
    };
  });

  if (!mutationResult || !mutationResult.ok) {
    if (isAjax) {
      return res.status(mutationResult && mutationResult.statusCode ? mutationResult.statusCode : 500).json({
        success: false,
        error: mutationResult && mutationResult.errorCode ? mutationResult.errorCode : 'save-failed',
        message: mutationResult && mutationResult.message ? mutationResult.message : 'Failed to save category',
      });
    }
    return res.redirect(buildErrorRedirect(redirectPath, mutationResult && mutationResult.errorCode ? mutationResult.errorCode : 'save-failed'));
  }

  if (isAjax) {
    successRedirectPath = resolveCategorySaveRedirectPath(
      mutationResult.categoryName,
      redirectPath,
      shouldReplaceCategoryItems
    );
    return res.json({
      success: true,
      message: 'Category saved successfully',
      categoryName: mutationResult.categoryName,
      originalCategoryName: mutationResult.originalCategoryName || '',
      categoryItems: Array.isArray(mutationResult.categoryItems) ? mutationResult.categoryItems : [],
      redirectPath: successRedirectPath,
    });
  }

  successRedirectPath = resolveCategorySaveRedirectPath(
    mutationResult.categoryName,
    redirectPath,
    shouldReplaceCategoryItems
  );

  return res.redirect(buildStatusRedirect(successRedirectPath, 'category-saved'));
}

async function acceptOrderRequest(req, res) {
  var requestBody = req && req.body && typeof req.body === 'object' ? req.body : {};
  var orderId = catalogService.toTrimmedString(requestBody.orderId);
  var adminMessage = normalizeMultilineText(requestBody.adminMessage);
  var redirectPath = getSafeRedirectPath(req, defaultAdminOrdersPath);
  var hasMongoConfiguration = Boolean(String(process.env.MONGODB_URI || '').trim());
  var isAjax = isAjaxRequest(req);
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

  function sendErrorResponse(errorCode, message, statusCode) {
    if (isAjax) {
      return res.status(statusCode || 400).json({ success: false, error: errorCode, message: message });
    }
    return res.redirect(buildErrorRedirect(redirectPath, errorCode));
  }

  function sendSuccessResponse(message) {
    if (isAjax) {
      return res.json({ success: true, message: message, orderId: orderId });
    }
    return res.redirect(buildStatusRedirect(redirectPath, 'order-accepted'));
  }

  if (!orderId) {
    return sendErrorResponse('order-id-required', 'Order ID required');
  }

  if (!/^[a-f0-9]{24}$/i.test(orderId)) {
    return sendErrorResponse('order-not-found', 'Order not found', 404);
  }

  if (adminMessage.length > maxAdminOrderMessageLength) {
    return sendErrorResponse('invalid-input', 'Message too long');
  }

  try {
    if (!await ensureDatabaseConnection()) {
      return sendErrorResponse('db-unavailable', 'Database unavailable', 503);
    }

    orderRecord = await Order.findById(orderId);

    if (!orderRecord) {
      return sendErrorResponse('order-not-found', 'Order not found', 404);
    }

    orderStatus = catalogService.toTrimmedString(orderRecord.adminStatus).toLowerCase();
    if (orderStatus === 'accepted') {
      if (isAjax) {
        return res.json({ success: true, message: 'Order already accepted', orderId: orderId, alreadyAccepted: true });
      }
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
            return sendErrorResponse('out-of-stock', 'Product out of stock', 400);
          }

          if (orderQuantity > availableStockQuantity) {
            return sendErrorResponse('insufficient-stock', 'Insufficient stock', 400);
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
        return sendErrorResponse('db-unavailable', 'Database unavailable', 503);
      }
      return sendErrorResponse('save-failed', 'Failed to save', 500);
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

    return sendSuccessResponse('Order accepted successfully');
  } catch (error) {
    console.error('Order accept action failed:', error.message);
    return sendErrorResponse('save-failed', 'Failed to process order', 500);
  }
}

async function deleteOrderRequest(req, res) {
  var requestBody = req && req.body && typeof req.body === 'object' ? req.body : {};
  var orderId = catalogService.toTrimmedString(requestBody.orderId);
  var redirectPath = getSafeRedirectPath(req, defaultAdminOrdersPath);
  var isAjax = isAjaxRequest(req);
  var deletedOrder = null;

  function sendErrorResponse(errorCode, message, statusCode) {
    if (isAjax) {
      return res.status(statusCode || 400).json({ success: false, error: errorCode, message: message });
    }
    return res.redirect(buildErrorRedirect(redirectPath, errorCode));
  }

  if (!orderId) {
    return sendErrorResponse('order-id-required', 'Order ID required');
  }

  if (!/^[a-f0-9]{24}$/i.test(orderId)) {
    return sendErrorResponse('order-not-found', 'Order not found', 404);
  }

  try {
    if (!await ensureDatabaseConnection()) {
      return sendErrorResponse('db-unavailable', 'Database unavailable', 503);
    }

    deletedOrder = await Order.findByIdAndDelete(orderId);

    if (!deletedOrder) {
      return sendErrorResponse('order-not-found', 'Order not found', 404);
    }

    if (isAjax) {
      return res.json({ success: true, message: 'Order deleted successfully', orderId: orderId });
    }
    return res.redirect(buildStatusRedirect(redirectPath, 'order-deleted'));
  } catch (error) {
    console.error('Order delete action failed:', error.message);
    return sendErrorResponse('save-failed', 'Failed to delete order', 500);
  }
}

function saveProduct(req, res) {
  catalogService.imageUpload.single('productImageFile')(req, res, async function (uploadError) {
    var redirectPath = getSafeRedirectPath(req, defaultAdminPath);
    var hasMongoConfiguration = Boolean(String(process.env.MONGODB_URI || '').trim());
    var hasDatabaseConnection = true;
    var isAjax = isAjaxRequest(req);
    var mutationResult = null;

    function sendErrorResponse(errorCode, message, statusCode) {
      if (isAjax) {
        return res.status(statusCode || 400).json({ success: false, error: errorCode, message: message });
      }
      return res.redirect(buildErrorRedirect(redirectPath, errorCode));
    }

    async function cleanupRejectedUploadFile() {
      var filePath = req && req.file && req.file.path ? String(req.file.path).trim() : '';
      if (!filePath) {
        return;
      }

      try {
        await fs.promises.unlink(filePath);
      } catch (error) {
        if (error && error.code === 'ENOENT') {
          return;
        }
        console.error('Failed to cleanup rejected upload:', error.message);
      }
    }

    if (uploadError) {
      var errorCode = 'save-failed';
      var errorMessage = 'Save failed';
      if (uploadError.code === 'LIMIT_FILE_SIZE') {
        errorCode = 'image-too-large';
        errorMessage = 'Image too large';
      } else if (uploadError.message === 'invalid-image-file') {
        errorCode = 'invalid-image-file';
        errorMessage = 'Invalid image file';
      }
      return sendErrorResponse(errorCode, errorMessage, 400);
    }

    if (!req.file) {
      return sendErrorResponse('product-image-file-required', 'Product image required', 400);
    }

    if (hasMongoConfiguration) {
      hasDatabaseConnection = await ensureDatabaseConnection();
      if (!hasDatabaseConnection) {
        return sendErrorResponse('db-unavailable', 'Database unavailable', 503);
      }
    }

    var categoryName = normalizeSingleLineText(req.body.productCategory);
    var productName = normalizeSingleLineText(req.body.productName);
    var rawProductSpec = normalizeMultilineText(req.body.productSpec);
    var productSpec = buildProductSpec(
      categoryName,
      rawProductSpec
    );
    var productPricing = resolveProductPricing(req.body.productPrice, req.body.productDiscountPercent);
    var productPrice = productPricing.price || 'Contact for price';
    var productQuantity = normalizeProductQuantity(req.body.productQuantity);
    var uploadedImagePath = '';

    if (!categoryName || !isWithinLength(categoryName, maxCategoryNameLength)) {
      await cleanupRejectedUploadFile();
      return sendErrorResponse('product-category-required', 'Product category required', 400);
    }

    if (!productName || !isWithinLength(productName, maxProductNameLength)) {
      await cleanupRejectedUploadFile();
      return sendErrorResponse('product-name-required', 'Product name required', 400);
    }

    if (!hasValidPriceValue(req.body.productPrice) || productPricing.isPriceMissing) {
      await cleanupRejectedUploadFile();
      return sendErrorResponse('product-price-required', 'Valid price required', 400);
    }

    if (!isWithinLength(rawProductSpec, maxProductSpecLength)) {
      await cleanupRejectedUploadFile();
      return sendErrorResponse('invalid-input', 'Invalid input', 400);
    }

    if (!hasValidQuantityValue(req.body.productQuantity)) {
      await cleanupRejectedUploadFile();
      return sendErrorResponse('invalid-input', 'Invalid quantity', 400);
    }

    uploadedImagePath = await catalogService.optimizeUploadedImage(req.file);

    if (!uploadedImagePath) {
      return sendErrorResponse('cloudinary-upload-failed', 'Image upload failed', 500);
    }

    mutationResult = await runAdminMutation(async function () {
      var latestCatalog = catalogService.getCatalogContext();
      var latestCategoryBoards = catalogService.buildAdminCategoryBoards(
        latestCatalog.categoryGroups,
        latestCatalog.productSections,
        latestCatalog.categoryKeywordMap
      );
      var matchedCategoryBoard = findCategoryBoardByName(categoryName, latestCategoryBoards);
      var resolvedCategoryName = '';
      var productId = '';
      var adminData = catalogService.getAdminData();
      var createdProductEntry = null;
      var primaryImage = uploadedImagePath;
      var primaryImages = catalogService.normalizeImageList([primaryImage], primaryImage);

      if (!matchedCategoryBoard) {
        return {
          ok: false,
          errorCode: 'category-not-found',
          message: 'Category not found',
          statusCode: 404,
        };
      }

      resolvedCategoryName = matchedCategoryBoard.name;

      if (hasDuplicateProductName(resolvedCategoryName, productName, latestCatalog.productSections)) {
        return {
          ok: false,
          errorCode: 'duplicate-product',
          message: 'Product already exists',
          statusCode: 409,
        };
      }

      productId = catalogService.buildUniqueProductId(resolvedCategoryName, productName, latestCatalog.productSections);

      if (!Array.isArray(adminData.products)) {
        adminData.products = [];
      }

      catalogService.upsertAdminCategory(resolvedCategoryName, '', [productName]);

      if (Array.isArray(adminData.deletedProductIds)) {
        adminData.deletedProductIds = adminData.deletedProductIds.filter(function (id) {
          return id !== productId;
        });
      }

      createdProductEntry = {
        id: productId,
        type: resolvedCategoryName,
        name: productName,
        spec: productSpec,
        price: productPrice,
        originalPrice: productPricing.originalPrice,
        discountPercent: productPricing.discountPercent ? String(productPricing.discountPercent) : '',
        quantity: productQuantity,
        image: primaryImage,
        images: primaryImages,
      };

      adminData.products.push(createdProductEntry);

      if (!await catalogService.saveAdminData()) {
        return {
          ok: false,
          errorCode: 'save-failed',
          message: 'Failed to save product',
          statusCode: 500,
        };
      }

      return {
        ok: true,
        product: createdProductEntry,
      };
    });

    if (!mutationResult || !mutationResult.ok) {
      if (uploadedImagePath) {
        await catalogService.cleanupLocalImageAsset(uploadedImagePath);
      }

      if (
        mutationResult &&
        mutationResult.errorCode === 'save-failed' &&
        hasMongoConfiguration
      ) {
        hasDatabaseConnection = await ensureDatabaseConnection();
        if (!hasDatabaseConnection) {
          return sendErrorResponse('db-unavailable', 'Database unavailable', 503);
        }
      }

      return sendErrorResponse(
        mutationResult && mutationResult.errorCode ? mutationResult.errorCode : 'save-failed',
        mutationResult && mutationResult.message ? mutationResult.message : 'Failed to save product',
        mutationResult && mutationResult.statusCode ? mutationResult.statusCode : 500
      );
    }

    if (isAjax) {
      return res.json({ success: true, message: 'Product saved successfully', product: mutationResult.product });
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
  renderAdminProductsPage: renderAdminProductsPage,
  redirectAdminCategoryRoot: redirectAdminCategoryRoot,
  renderAdminOrdersPage: renderAdminOrdersPage,
  renderAdminPage: renderAdminPage,
  saveCategory: saveCategory,
  saveProduct: saveProduct,
  saveProductImage: saveProductImage,
  saveProductPrice: saveProductPrice,
};
