import fs from 'fs';
import mongoose from 'mongoose';
import catalogService from '../services/catalogService.js';
import Category from '../models/Category.js';
import Order from '../models/Order.js';
import Product from '../models/Product.js';
import database from '../lib/db.js';
import config from '../lib/config.js';
import resendService from '../services/resendService.js';



let defaultAdminPath = '/admin';
let defaultAdminOrdersPath = '/admin/orders';
let maxCategoryNameLength = 80;
let maxCategoryDescriptionLength = 240;
let maxCategoryItemsCount = 50;
let maxProductNameLength = 120;
let maxProductSpecLength = 600;
let maxPriceValue = 100000000;
let maxQuantityValue = 1000000;
let adminProductOverviewPageSize = 20;
let adminCategoryItemsPageSize = 12;
let maxAdminOrderMessageLength = 1000;
let adminOrderRequestsLimit = 150;
let adminOrderRequestsPageSize = 10;
let adminOrderListSelectFields = 'productId productName productType quantity totalLabel customerName customerEmail phoneNumber note createdAt adminAcceptedAt adminStatus';
let adminMutationQueue = Promise.resolve();

function toCategorySlug(value) {
  return catalogService.normalizeForSearch(value).replace(/\s+/g, '-');
}

function buildCategoryAdminPath(categoryName) {
  let categorySlug = toCategorySlug(categoryName);

  if (!categorySlug) {
    return defaultAdminPath;
  }

  return '/admin/categories/' + categorySlug;
}

function buildAdminProductsPagePath(page, categorySlug) {
  let parsedPage = Number(page);
  let safePage = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1;
  let safeCategorySlug = toCategorySlug(categorySlug);
  let basePath = '';

  if (safePage <= 1) {
    basePath = '/admin/products';
  } else {
    basePath = '/admin/products?page=' + safePage;
  }

  if (!safeCategorySlug) {
    return basePath;
  }

  return appendRedirectParam(basePath, 'category', safeCategorySlug);
}

function getSafeRedirectPath(req, fallbackPath) {
  let targetPath = catalogService.toTrimmedString(req && req.body ? req.body.redirectTo : '');
  let safeFallbackPath = fallbackPath || defaultAdminPath;

  if (!targetPath || targetPath.charAt(0) !== '/' || targetPath.indexOf('/admin') !== 0) {
    return safeFallbackPath;
  }

  return targetPath;
}

function appendRedirectParam(targetPath, key, value) {
  let safePath = targetPath || defaultAdminPath;
  let separator = safePath.indexOf('?') === -1 ? '?' : '&';

  return safePath + separator + key + '=' + encodeURIComponent(value);
}

function buildErrorRedirect(targetPath, errorCode) {
  return appendRedirectParam(targetPath, 'error', errorCode);
}

function buildStatusRedirect(targetPath, statusCode) {
  return appendRedirectParam(targetPath, 'status', statusCode);
}

function normalizeSingleLineText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeMultilineText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
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
  let normalizedValue = catalogService.toTrimmedString(value);

  return /^[a-z0-9][a-z0-9-]*$/i.test(normalizedValue) || mongoose.isValidObjectId(normalizedValue);
}

function parsePositiveInteger(value, fallbackValue) {
  let parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallbackValue;
  }

  return Math.floor(parsedValue);
}

function parseNonNegativeNumber(value) {
  let rawValue = catalogService.toTrimmedString(value).replace(/,/g, '');
  let matchedValue = rawValue.match(/-?\d+(\.\d+)?/);
  let parsedValue = matchedValue ? Number(matchedValue[0]) : NaN;

  if (!matchedValue || !Number.isFinite(parsedValue) || parsedValue < 0) {
    return NaN;
  }

  return parsedValue;
}

function hasValidPriceValue(value) {
  let parsedValue = parseNonNegativeNumber(value);

  return Number.isFinite(parsedValue) && parsedValue <= maxPriceValue;
}

function hasValidQuantityValue(value) {
  let parsedValue = parseNonNegativeNumber(value);

  return Number.isFinite(parsedValue) && parsedValue <= maxQuantityValue;
}

function normalizeDiscountPercent(value) {
  let parsedValue = parseNonNegativeNumber(value);

  if (!Number.isFinite(parsedValue)) {
    return 0;
  }

  return Math.min(Math.round(parsedValue * 100) / 100, 100);
}

function resolveProductPricing(rawPrice, rawDiscountPercent) {
  let parsedMrp = parseNonNegativeNumber(rawPrice);
  let discountPercent = normalizeDiscountPercent(rawDiscountPercent);
  let discountedValue = 0;
  let hasDiscount = false;

  if (!catalogService.toTrimmedString(rawPrice)) {
    return {
      isPriceMissing: true,
      priceValue: NaN,
      compareAtPriceValue: null,
      discountPercent: 0,
    };
  }

  if (!Number.isFinite(parsedMrp)) {
    return {
      isPriceMissing: false,
      priceValue: NaN,
      compareAtPriceValue: null,
      discountPercent: 0,
    };
  }

  discountedValue = Math.round(parsedMrp * ((100 - discountPercent) / 100) * 100) / 100;
  hasDiscount = discountPercent > 0 && discountedValue < parsedMrp;

  return {
    isPriceMissing: false,
    priceValue: discountedValue,
    compareAtPriceValue: hasDiscount ? parsedMrp : null,
    discountPercent: hasDiscount ? discountPercent : 0,
  };
}

function buildProductSpec(categoryName, rawSpec) {
  let specText = catalogService.toTrimmedString(rawSpec);

  if (/^n\/?a$/i.test(specText)) {
    return '';
  }

  return specText;
}

function sanitizeCategoryItems(rawItems) {
  return catalogService.parseCommaSeparatedList(rawItems)
    .slice(0, maxCategoryItemsCount)
    .map(function (item) {
      return normalizeSingleLineText(item);
    })
    .filter(function (item) {
      return item && item.length <= maxProductNameLength;
    });
}

function findCategoryBoardBySlug(categorySlug, categoryBoards) {
  let slug = catalogService.toTrimmedString(categorySlug).toLowerCase();
  let normalizedSlug = catalogService.normalizeForSearch(slug.replace(/-/g, ' '));
  let matchedBySlug = null;

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
  let normalizedName = catalogService.normalizeForSearch(categoryName);

  if (!normalizedName) {
    return null;
  }

  return (categoryBoards || []).find(function (board) {
    return catalogService.normalizeForSearch(board && board.name) === normalizedName;
  }) || null;
}

function buildAdminCategoryRecordsByKey(categoryDocs) {
  let categoryRecordsByKey = Object.create(null);

  (categoryDocs || []).forEach(function (categoryDoc) {
    let categoryName = normalizeSingleLineText(categoryDoc && categoryDoc.name);
    let categoryKey = toCategorySlug(categoryName);

    if (!categoryKey) {
      return;
    }

    categoryRecordsByKey[categoryKey] = {
      name: categoryName,
      description: normalizeMultilineText(categoryDoc && categoryDoc.description),
      items: Array.isArray(categoryDoc && categoryDoc.items) ? categoryDoc.items.slice() : [],
    };
  });

  return categoryRecordsByKey;
}

function buildDashboardStats(categoryBoards) {
  let boards = Array.isArray(categoryBoards) ? categoryBoards : [];
  let totalCategories = boards.length;
  let totalProducts = boards.reduce(function (total, board) {
    return total + (Array.isArray(board && board.items) ? board.items.length : 0);
  }, 0);
  let emptyCategories = boards.reduce(function (total, board) {
    return total + (Array.isArray(board && board.items) && board.items.length === 0 ? 1 : 0);
  }, 0);
  let averageProductsPerCategory = totalCategories > 0 ? (totalProducts / totalCategories) : 0;

  return {
    totalCategories: totalCategories,
    totalProducts: totalProducts,
    emptyCategories: emptyCategories,
    averageProductsPerCategory: Number(averageProductsPerCategory.toFixed(1)),
    adminOnlyCategories: 0,
    adminOnlyProducts: 0,
    priceOverrides: 0,
    imageOverrides: 0,
    productOverrides: 0,
    deletedProductIds: 0,
    deletedCategoryNames: 0,
  };
}

function parseNumericText(value) {
  let cleanedValue = String(value === null || typeof value === 'undefined' ? '' : value)
    .replace(/,/g, '')
    .replace(/[^0-9.\-]/g, '')
    .trim();
  let parsedValue = Number(cleanedValue);

  if (!cleanedValue || !Number.isFinite(parsedValue)) {
    return NaN;
  }

  return parsedValue;
}

function formatDiscountPercent(value) {
  let numericValue = Number(value);
  let roundedValue = 0;

  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return '';
  }

  roundedValue = Math.round(numericValue * 100) / 100;
  return String(roundedValue)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*[1-9])0+$/, '$1');
}

function computeDiscountPercent(finalPriceValue, actualPriceValue) {
  let numericFinal = Number(finalPriceValue);
  let numericActual = Number(actualPriceValue);

  if (!Number.isFinite(numericFinal) || numericFinal <= 0) {
    return NaN;
  }

  if (!Number.isFinite(numericActual) || numericActual <= numericFinal) {
    return NaN;
  }

  return ((numericActual - numericFinal) / numericActual) * 100;
}

function normalizePriceLabel(value) {
  let trimmedValue = String(value === null || typeof value === 'undefined' ? '' : value).trim();
  let parsedValue = NaN;

  if (!trimmedValue) {
    return '';
  }

  if (/^contact for price$/i.test(trimmedValue)) {
    return 'Contact for price';
  }

  parsedValue = parseNumericText(trimmedValue);
  if (Number.isFinite(parsedValue)) {
    return catalogService.formatNprAmount(parsedValue);
  }

  return trimmedValue;
}

function resolveAdminRowPricing(item) {
  let record = item && typeof item === 'object' ? item : {};
  let rawFinalPrice = record.price;
  let rawOriginalPrice = record.originalPrice;
  let rawCompareAtPrice = record.compareAtPrice;
  let rawDiscountPercent = record.discountPercent;
  let finalPriceValue = parseNumericText(rawFinalPrice);
  let compareAtValue = parseNumericText(rawCompareAtPrice);
  let originalPriceValue = parseNumericText(rawOriginalPrice);
  let discountPercentValue = parseNumericText(rawDiscountPercent);
  let actualPriceValue = Number.isFinite(compareAtValue) ? compareAtValue : originalPriceValue;
  let computedDiscountValue = NaN;
  let hasDiscount = false;
  let finalPriceLabel = normalizePriceLabel(rawFinalPrice);
  let originalPriceLabel = '';
  let discountPercentLabel = '';

  if (!finalPriceLabel && Number.isFinite(finalPriceValue)) {
    finalPriceLabel = catalogService.formatNprAmount(finalPriceValue);
  }

  if (!finalPriceLabel) {
    finalPriceLabel = 'Contact for price';
  }

  if (!Number.isFinite(actualPriceValue) && Number.isFinite(finalPriceValue) && Number.isFinite(discountPercentValue) && discountPercentValue > 0 && discountPercentValue < 100) {
    actualPriceValue = Math.round((finalPriceValue / ((100 - discountPercentValue) / 100)) * 100) / 100;
  }

  if (!Number.isFinite(discountPercentValue)) {
    computedDiscountValue = computeDiscountPercent(finalPriceValue, actualPriceValue);
    if (Number.isFinite(computedDiscountValue)) {
      discountPercentValue = computedDiscountValue;
    }
  }

  hasDiscount = Number.isFinite(finalPriceValue) && Number.isFinite(actualPriceValue) && actualPriceValue > finalPriceValue;

  if (hasDiscount) {
    originalPriceLabel = normalizePriceLabel(rawOriginalPrice || rawCompareAtPrice);

    if (!originalPriceLabel && Number.isFinite(actualPriceValue)) {
      originalPriceLabel = catalogService.formatNprAmount(actualPriceValue);
    }

    discountPercentLabel = formatDiscountPercent(discountPercentValue);
  }

  return {
    price: finalPriceLabel,
    originalPrice: originalPriceLabel,
    discountPercent: discountPercentLabel,
  };
}

function buildAdminProductRows(categoryBoards) {
  let rows = [];

  (categoryBoards || []).forEach(function (board) {
    let categoryName = catalogService.toTrimmedString(board && board.name);

    (board && board.items || []).forEach(function (item) {
      let pricing = resolveAdminRowPricing(item);

      rows.push({
        id: catalogService.toTrimmedString(item && item.id),
        categoryName: categoryName,
        type: categoryName,
        name: catalogService.toTrimmedString(item && item.name),
        spec: catalogService.toTrimmedString(item && item.spec),
        price: pricing.price,
        originalPrice: pricing.originalPrice,
        discountPercent: pricing.discountPercent,
        quantity: Number(item && item.quantity) || 0,
        image: catalogService.normalizeAssetPath(item && item.image),
        addedOrder: Number(item && item.addedOrder) || 0,
      });
    });
  });

  rows.sort(function (left, right) {
    return (
      String(left && left.name ? left.name : '').localeCompare(String(right && right.name ? right.name : '')) ||
      String(left && left.categoryName ? left.categoryName : '').localeCompare(String(right && right.categoryName ? right.categoryName : ''))
    );
  });

  return rows;
}

function paginateAdminProductRows(productRows, requestedPage, pageSize) {
  let rows = Array.isArray(productRows) ? productRows : [];
  let parsedPageSize = Number(pageSize);
  let safePageSize = Number.isFinite(parsedPageSize) && parsedPageSize > 0 ? Math.floor(parsedPageSize) : adminProductOverviewPageSize;
  let totalPages = Math.max(1, Math.ceil(rows.length / safePageSize));
  let parsedPage = Number(requestedPage);
  let safePage = Number.isFinite(parsedPage) && parsedPage > 0 ? Math.floor(parsedPage) : 1;
  let startIndex = 0;

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

function buildCategoryFilterOptionsFromRows(productRows) {
  let rows = Array.isArray(productRows) ? productRows : [];
  let countBySlug = Object.create(null);
  let nameBySlug = Object.create(null);

  rows.forEach(function (row) {
    let rawName = catalogService.toTrimmedString(row && row.categoryName);
    let categoryName = rawName || catalogService.toTrimmedString(row && row.type) || '';
    let slug = toCategorySlug(categoryName);

    if (!slug || !categoryName) {
      return;
    }

    if (!nameBySlug[slug]) {
      nameBySlug[slug] = categoryName;
    }

    countBySlug[slug] = (Number(countBySlug[slug]) || 0) + 1;
  });

  return Object.keys(nameBySlug).map(function (slug) {
    return {
      slug: slug,
      name: nameBySlug[slug],
      count: Number(countBySlug[slug]) || 0,
    };
  }).sort(function (left, right) {
    return String(left && left.name ? left.name : '').localeCompare(String(right && right.name ? right.name : ''));
  });
}

function buildCategoryFilterOptionsFromSections(productSections) {
  let sections = Array.isArray(productSections) ? productSections : [];

  return sections.map(function (section) {
    let name = catalogService.toTrimmedString(section && section.title);
    let slug = toCategorySlug(name);
    let count = Array.isArray(section && section.items) ? section.items.length : 0;

    return { slug: slug, name: name, count: count };
  }).filter(function (option) {
    return Boolean(option && option.slug && option.name);
  }).sort(function (left, right) {
    return String(left && left.name ? left.name : '').localeCompare(String(right && right.name ? right.name : ''));
  });
}

function buildAdminOrderAcceptedEmailText(orderRecord, adminMessage) {
  let productName = catalogService.toTrimmedString(orderRecord && orderRecord.productName) || 'Product';
  let productType = catalogService.toTrimmedString(orderRecord && orderRecord.productType) || 'Category';
  let quantity = Number(orderRecord && orderRecord.quantity);
  let safeQuantity = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
  let totalLabel = catalogService.toTrimmedString(orderRecord && orderRecord.totalLabel) || 'Contact for price';
  let messageText = catalogService.toTrimmedString(adminMessage);
  let lines = [];

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
  let productName = catalogService.toTrimmedString(orderRecord && orderRecord.productName) || 'Product';
  let productType = catalogService.toTrimmedString(orderRecord && orderRecord.productType) || 'Category';
  let quantity = Number(orderRecord && orderRecord.quantity);
  let safeQuantity = Number.isFinite(quantity) && quantity > 0 ? Math.floor(quantity) : 1;
  let totalLabel = catalogService.toTrimmedString(orderRecord && orderRecord.totalLabel) || 'Contact for price';
  let messageText = catalogService.toTrimmedString(adminMessage);
  let messageBlock = '';

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
  let config = options && typeof options === 'object' ? options : {};
  let requestedView = catalogService.normalizeForSearch(config.view);
  let requestedPage = parsePositiveInteger(config.page, 1);
  let requestedPageSize = parsePositiveInteger(config.pageSize, adminOrderRequestsPageSize);
  let safePageSize = Math.max(1, Math.min(requestedPageSize, adminOrderRequestsLimit));
  let resolvedView = 'pending';
  let page = 1;
  let totalPages = 1;
  let counts = {
    total: 0,
    pending: 0,
    accepted: 0,
  };
  let orders = [];
  let loadError = '';
  let pendingFilter = { adminStatus: mongoose.trusted({ $in: ['pending', 'processing'] }) };
  let acceptedFilter = { adminStatus: 'accepted' };
  let selectedFilter = pendingFilter;
  let selectedCount = 0;
  let skipCount = 0;

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

    let countResults = await Promise.all([
      Order.countDocuments(pendingFilter),
      Order.countDocuments(acceptedFilter),
    ]);

    counts.pending = Number(countResults[0]) || 0;
    counts.accepted = Number(countResults[1]) || 0;
    counts.total = counts.pending + counts.accepted;

    if (requestedView === 'pending' || requestedView === 'accepted') {
      resolvedView = requestedView;
    } else if (!counts.pending && counts.accepted) {
      resolvedView = 'accepted';
    }

    selectedFilter = resolvedView === 'accepted' ? acceptedFilter : pendingFilter;
    selectedCount = resolvedView === 'accepted' ? counts.accepted : counts.pending;
    totalPages = Math.max(1, Math.ceil(selectedCount / safePageSize));
    page = Math.min(requestedPage, totalPages);
    skipCount = Math.max(0, (page - 1) * safePageSize);

    orders = await Order.find(selectedFilter)
      .select(adminOrderListSelectFields)
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

function isAjaxRequest(req) {
  let acceptHeader = String(req && req.headers ? req.headers.accept || '' : '').toLowerCase();
  let requestedWithHeader = String(req && req.headers ? req.headers['x-requested-with'] || '' : '');

  return Boolean(
    (req && req.xhr) ||
    requestedWithHeader === 'XMLHttpRequest' ||
    acceptHeader.indexOf('application/json') !== -1
  );
}

function runAdminMutation(task) {
  let queuedTask = adminMutationQueue.then(function () {
    return Promise.resolve().then(task);
  });

  adminMutationQueue = queuedTask.catch(function () {
    return undefined;
  });

  return queuedTask;
}

function buildProductIdentifierFilter(productId) {
  let normalizedProductId = catalogService.toTrimmedString(productId);
  let filters = [{ legacyId: normalizedProductId }];

  if (mongoose.isValidObjectId(normalizedProductId)) {
    filters.push({ _id: normalizedProductId });
  }

  return { $or: filters };
}

async function loadProductDtoById(productId) {
  return catalogService.getCatalogProductByIdentifier(productId);
}

async function loadSoldCountMap(productIds) {
  let normalizedProductIds = (productIds || []).map(function (productId) {
    return catalogService.toTrimmedString(productId);
  }).filter(Boolean);
  let soldGroups = [];
  let soldById = {};

  if (!normalizedProductIds.length || !await ensureDatabaseConnection()) {
    return soldById;
  }

  soldGroups = await Order.aggregate([
    { $match: { productId: { $in: normalizedProductIds }, adminStatus: 'accepted' } },
    { $group: { _id: '$productId', sold: { $sum: '$quantity' } } },
  ]).allowDiskUse(true);

  (soldGroups || []).forEach(function (group) {
    if (!group || !group._id) {
      return;
    }

    soldById[String(group._id)] = Number.isFinite(Number(group.sold)) ? Number(group.sold) : 0;
  });

  return soldById;
}

function resolveCategorySaveRedirectPath(categoryName, redirectPath, shouldReplaceCategoryItems) {
  let safeRedirectPath = catalogService.toTrimmedString(redirectPath) || defaultAdminPath;

  if (shouldReplaceCategoryItems && safeRedirectPath.indexOf('/admin/categories') === 0) {
    return buildCategoryAdminPath(categoryName);
  }

  return safeRedirectPath;
}

function isDuplicateKeyError(error) {
  return Boolean(error) && Number(error.code) === 11000;
}

function isTransactionNotSupportedError(error) {
  let message = String(error && error.message ? error.message : '').toLowerCase();
  let codeName = String(error && error.codeName ? error.codeName : '').toLowerCase();

  return (
    codeName === 'illegaloperation' ||
    message.indexOf('transaction numbers are only allowed') !== -1 ||
    message.indexOf('replica set member or mongos') !== -1 ||
    message.indexOf('transactions are not supported') !== -1
  );
}

async function findCategoryDocByName(categoryName) {
  let normalizedCategoryName = catalogService.normalizeForSearch(categoryName);

  if (!normalizedCategoryName) {
    return null;
  }

  return Category.findOne({ normalizedName: normalizedCategoryName });
}

async function findOrCreateCategoryDocByName(categoryName) {
  let existing = await findCategoryDocByName(categoryName);

  if (existing) {
    return existing;
  }

  try {
    return await Category.create({
      name: categoryName,
      description: '',
      items: [],
      sortOrder: 0,
      isActive: true,
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return await findCategoryDocByName(categoryName);
    }

    throw error;
  }
}

function refreshAdminDataMiddleware(req, res, next) {
  return next();
}

async function renderAdminPage(req, res) {
  let catalog = await catalogService.getCatalogContext();
  let status = catalogService.toTrimmedString(req.query.status);
  let error = catalogService.toTrimmedString(req.query.error);
  let categoryBoards = catalogService.buildAdminCategoryBoards(
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
    adminCategoryRecords: buildAdminCategoryRecordsByKey(catalog.categoryGroups),
    dashboardStats: buildDashboardStats(categoryBoards),
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
}

async function renderAdminProductsPage(req, res) {
  let catalog = await catalogService.getCatalogContext({ forceRefresh: true });
  let status = catalogService.toTrimmedString(req.query.status);
  let error = catalogService.toTrimmedString(req.query.error);
  let requestedPage = parsePositiveInteger(req.query.page, 1);
  let requestedCategorySlug = toCategorySlug(req.query.category);
  let categoryBoards = catalogService.buildAdminCategoryBoards(
    catalog.categoryGroups,
    catalog.productSections,
    catalog.categoryKeywordMap
  );
  let allProductRows = buildAdminProductRows(categoryBoards);
  let filteredProductRows = requestedCategorySlug
    ? allProductRows.filter(function (row) {
        return toCategorySlug(row && row.categoryName) === requestedCategorySlug;
      })
    : allProductRows;
  let pagination = paginateAdminProductRows(filteredProductRows, requestedPage, adminProductOverviewPageSize);
  let soldById = {};
  let selectedCategoryBoard = requestedCategorySlug
    ? findCategoryBoardBySlug(requestedCategorySlug, categoryBoards)
    : null;
  let selectedCategoryName = selectedCategoryBoard && selectedCategoryBoard.name
    ? String(selectedCategoryBoard.name)
    : '';

  try {
    soldById = await loadSoldCountMap(pagination.rows.map(function (row) {
      return row && row.id;
    }));
  } catch (error) {
    console.error('Failed to attach sold counts for admin products page:', error.message);
  }

  pagination.rows.forEach(function (row) {
    row.sold = soldById[row.id] || 0;
  });

  return res.render('admin-products', {
    title: 'Products | Admin Panel | BhutanDevi Trade and Suppliers',
    statusMessage: catalogService.getAdminStatusMessage(status),
    errorMessage: catalogService.getAdminErrorMessage(error),
    categoryBoards: categoryBoards,
    categoryFilterOptions: (function () {
      let fromSections = buildCategoryFilterOptionsFromSections(catalog && catalog.productSections);
      return fromSections && fromSections.length ? fromSections : buildCategoryFilterOptionsFromRows(allProductRows);
    })(),
    adminCategoryRecords: buildAdminCategoryRecordsByKey(catalog.categoryGroups),
    selectedCategorySlug: requestedCategorySlug,
    selectedCategoryName: selectedCategoryName,
    productRows: pagination.rows,
    totalProductCount: pagination.totalCount,
    totalProductCountAll: allProductRows.length,
    adminProductsPage: pagination.page,
    adminProductsTotalPages: pagination.totalPages,
    adminProductsPagePath: buildAdminProductsPagePath(pagination.page, requestedCategorySlug),
    dashboardStats: buildDashboardStats(categoryBoards),
  });
}

async function renderAdminOrdersPage(req, res) {
  let status = catalogService.toTrimmedString(req.query.status);
  let error = catalogService.toTrimmedString(req.query.error);
  let orderView = catalogService.normalizeForSearch(req.query.view);
  let orderPage = parsePositiveInteger(req.query.page, 1);
  let pageData = await Promise.all([
    catalogService.getCatalogContext(),
    loadAdminOrdersForDashboard({
      view: orderView,
      page: orderPage,
      pageSize: adminOrderRequestsPageSize,
    }),
  ]);
  let catalog = pageData[0];
  let adminOrdersData = pageData[1];
  let orderCounts = adminOrdersData && adminOrdersData.counts
    ? adminOrdersData.counts
    : { total: 0, pending: 0, accepted: 0 };

  return res.render('admin-orders', {
    title: 'Order Requests | Admin Panel | BhutanDevi Trade and Suppliers',
    q: '',
    activeCategory: '',
    statusMessage: catalogService.getAdminStatusMessage(status),
    errorMessage: catalogService.getAdminErrorMessage(error),
    adminOrderRequests: Array.isArray(adminOrdersData.orders) ? adminOrdersData.orders : [],
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
  let categorySlug = catalogService.toTrimmedString(req.params.categorySlug);
  let catalog = await catalogService.getCatalogContext();
  let status = catalogService.toTrimmedString(req.query.status);
  let error = catalogService.toTrimmedString(req.query.error);
  let categoryItemsPage = parsePositiveInteger(req.query.itemsPage, 1);
  let categoryBoards = catalogService.buildAdminCategoryBoards(
    catalog.categoryGroups,
    catalog.productSections,
    catalog.categoryKeywordMap
  );
  let categoryBoard = findCategoryBoardBySlug(categorySlug, categoryBoards);
  let categoryRecordsByKey = buildAdminCategoryRecordsByKey(catalog.categoryGroups);
  let soldById = {};

  if (!categoryBoard) {
    return res.redirect(buildErrorRedirect(defaultAdminPath, 'category-not-found'));
  }

  try {
    soldById = await loadSoldCountMap((categoryBoard.items || []).map(function (item) {
      return item && item.id;
    }));
  } catch (error) {
    console.error('Failed to attach sold counts for admin category page:', error.message);
  }

  (categoryBoard.items || []).forEach(function (item) {
    item.sold = soldById[item.id] || 0;
  });

  return res.render('admin-category', {
    title: categoryBoard.name + ' | Admin Panel | BhutanDevi Trade and Suppliers',
    q: '',
    activeCategory: '',
    statusMessage: catalogService.getAdminStatusMessage(status),
    errorMessage: catalogService.getAdminErrorMessage(error),
    categoryBoard: categoryBoard,
    categoryRecord: categoryRecordsByKey[toCategorySlug(categoryBoard.name)] || null,
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
  let productId = catalogService.toTrimmedString(req.body.productId);
  let parsedPrice = parseNonNegativeNumber(req.body.productPrice);
  let redirectPath = getSafeRedirectPath(req, defaultAdminPath);
  let isAjax = isAjaxRequest(req);
  let mutationResult = null;

  if (!await ensureDatabaseConnection()) {
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
    let productDoc = await Product.findOne(buildProductIdentifierFilter(productId));

    if (!productDoc) {
      return {
        ok: false,
        errorCode: 'product-not-found',
        message: 'Product not found',
        statusCode: 404,
      };
    }

    productDoc.price = parsedPrice;
    if (Number(productDoc.compareAtPrice) <= Number(productDoc.price)) {
      productDoc.compareAtPrice = null;
    }

    await productDoc.save();
    catalogService.clearCatalogContextCache();

    return {
      ok: true,
      price: catalogService.formatNprAmount(parsedPrice),
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
    return res.json({
      success: true,
      message: 'Price saved successfully',
      price: mutationResult.price,
    });
  }

  return res.redirect(buildStatusRedirect(redirectPath, 'price-saved'));
}

function saveProductImage(req, res) {
  catalogService.imageUpload.single('productImageFile')(req, res, async function (uploadError) {
    let redirectPath = getSafeRedirectPath(req, defaultAdminPath);
    let isAjax = isAjaxRequest(req);
    let mutationResult = null;
    let uploadedImagePath = '';

    function sendErrorResponse(errorCode, message, statusCode) {
      if (uploadedImagePath) {
        catalogService.cleanupLocalImageAsset(uploadedImagePath).catch(function (error) {
          console.error('Failed to cleanup rejected uploaded image:', error.message);
        });
      }

      if (!uploadedImagePath && req && req.file && req.file.path) {
        fs.promises.unlink(req.file.path).catch(function (error) {
          if (error && error.code !== 'ENOENT') {
            console.error('Failed to cleanup rejected upload:', error.message);
          }
        });
      }

      if (isAjax) {
        return res.status(statusCode || 400).json({ success: false, error: errorCode, message: message });
      }

      return res.redirect(buildErrorRedirect(redirectPath, errorCode));
    }

    try {
      if (uploadError) {
        return sendErrorResponse(
          uploadError.code === 'LIMIT_FILE_SIZE' ? 'image-too-large' : 'invalid-image-file',
          uploadError.code === 'LIMIT_FILE_SIZE' ? 'Image too large' : 'Invalid image file',
          400
        );
      }

      if (!req.file) {
        return sendErrorResponse('product-image-file-required', 'Image file required', 400);
      }

      if (!await ensureDatabaseConnection()) {
        return sendErrorResponse('db-unavailable', 'Database unavailable', 503);
      }

      uploadedImagePath = await catalogService.optimizeAndPromoteUploadedImage(req.file);

      if (!uploadedImagePath) {
        return sendErrorResponse('invalid-image-file', 'Image upload failed', 400);
      }

      mutationResult = await runAdminMutation(async function () {
        let productId = catalogService.toTrimmedString(req.body.productId);
        let productDoc = null;

        if (!productId || !isValidEntityId(productId)) {
          return {
            ok: false,
            errorCode: 'product-id-required',
            message: 'Product ID required',
            statusCode: 400,
          };
        }

        productDoc = await Product.findOne(buildProductIdentifierFilter(productId));

        if (!productDoc) {
          return {
            ok: false,
            errorCode: 'product-not-found',
            message: 'Product not found',
            statusCode: 404,
          };
        }

        productDoc.imageUrl = uploadedImagePath;
        productDoc.images = catalogService.normalizeImageList([uploadedImagePath].concat(productDoc.images || []), uploadedImagePath);
        await productDoc.save();
        catalogService.clearCatalogContextCache();

        return {
          ok: true,
          image: uploadedImagePath,
        };
      });

      if (!mutationResult || !mutationResult.ok) {
        return sendErrorResponse(
          mutationResult && mutationResult.errorCode ? mutationResult.errorCode : 'save-failed',
          mutationResult && mutationResult.message ? mutationResult.message : 'Failed to save image',
          mutationResult && mutationResult.statusCode ? mutationResult.statusCode : 500
        );
      }

      if (isAjax) {
        return res.json({ success: true, message: 'Image saved successfully', image: mutationResult.image });
      }

      return res.redirect(buildStatusRedirect(redirectPath, 'image-saved'));
    } catch (error) {
      console.error('[ERROR]', {
        route: req && req.originalUrl ? req.originalUrl : '',
        method: req && req.method ? req.method : '',
        message: error && error.message ? error.message : 'Unknown error',
        stack: error && error.stack ? error.stack : '',
        timestamp: new Date().toISOString(),
      });

      if (res.headersSent) {
        return;
      }

      return sendErrorResponse('save-failed', 'Failed to save image', 500);
    }
  });
}


async function editProduct(req, res) {
  const redirectPath = getSafeRedirectPath(req, defaultAdminPath);
  const isAjax = isAjaxRequest(req);
  let uploadedImagePath = '';

  const sendError = async (errorCode, message, statusCode = 400) => {
    if (uploadedImagePath) {
      await catalogService.cleanupLocalImageAsset(uploadedImagePath).catch(err =>
        console.error('Failed to cleanup rejected uploaded image:', err.message)
      );
    }
    if (!uploadedImagePath && req && req.file && req.file.path) {
      await fs.promises.unlink(req.file.path).catch(function (error) {
        if (error && error.code !== 'ENOENT') {
          console.error('Failed to cleanup rejected upload:', error.message);
        }
      });
    }
    if (isAjax) return res.status(statusCode).json({ success: false, error: errorCode, message });
    return res.redirect(buildErrorRedirect(redirectPath, errorCode));
  };

  // Handle image upload
  catalogService.imageUpload.single('productImageFile')(req, res, async function (uploadError) {
    if (uploadError) {
      const code = uploadError.code === 'LIMIT_FILE_SIZE' ? 'image-too-large' : 'invalid-image-file';
      const msg = uploadError.code === 'LIMIT_FILE_SIZE' ? 'Image too large' : 'Invalid image file';
      return sendError(code, msg, 400);
    }

    if (!await ensureDatabaseConnection()) return sendError('db-unavailable', 'Database unavailable', 503);

    try {
      const productId = catalogService.toTrimmedString(req.body.productId);
      const requestedProductCategory = normalizeSingleLineText(req.body.productCategory);
      const productName = normalizeSingleLineText(req.body.productName);
      const rawProductSpec = normalizeMultilineText(req.body.productSpec);
      const productSpec = buildProductSpec(requestedProductCategory, rawProductSpec);
      const productPricing = resolveProductPricing(req.body.productPrice, req.body.productDiscountPercent);
      const currentImagePath = catalogService.normalizeAssetPath(req.body.currentImagePath);

      if (req.file) {
        uploadedImagePath = await catalogService.optimizeAndPromoteUploadedImage(req.file);
        if (!uploadedImagePath) return sendError('cloudinary-upload-failed', 'Image upload failed', 500);
      }

      // Basic validations
      if (!productId || !isValidEntityId(productId)) return sendError('product-id-required', 'Product ID required', 400);
      if (!requestedProductCategory || !isWithinLength(requestedProductCategory, maxCategoryNameLength)) return sendError('product-category-required', 'Product category required', 400);
      if (!productName || !isWithinLength(productName, maxProductNameLength)) return sendError('product-name-required', 'Product name required', 400);
      if (!hasValidPriceValue(req.body.productPrice) || productPricing.isPriceMissing || !Number.isFinite(productPricing.priceValue)) return sendError('product-price-required', 'Valid price required', 400);
      if (!isWithinLength(rawProductSpec, maxProductSpecLength) || !hasValidQuantityValue(req.body.productQuantity)) return sendError('invalid-input', 'Invalid input', 400);

      // Main mutation
      const mutationResult = await runAdminMutation(async () => {
        const productDoc = await Product.findOne(buildProductIdentifierFilter(productId));
        if (!productDoc) return { ok: false, errorCode: 'product-not-found', message: 'Product not found', statusCode: 404 };

        const categoryDoc = await findOrCreateCategoryDocByName(requestedProductCategory);
        if (!categoryDoc) return { ok: false, errorCode: 'category-not-found', message: 'Category not found', statusCode: 404 };

        // Duplicate check (avoid ObjectId $ne casting issues)
        const duplicateProduct = await Product.findOne({
          category: categoryDoc._id,
          normalizedName: catalogService.normalizeForSearch(productName),
        }).select('_id').lean();

        if (duplicateProduct && String(duplicateProduct._id) !== String(productDoc._id)) {
          return { ok: false, errorCode: 'duplicate-product', message: 'Product already exists', statusCode: 409 };
        }

        // Update fields
        const resolvedImagePath = uploadedImagePath || currentImagePath || '';
        productDoc.category = categoryDoc._id;
        productDoc.name = productName;
        productDoc.spec = productSpec;
        productDoc.description = productSpec;
        productDoc.price = productPricing.priceValue;
        productDoc.compareAtPrice = productPricing.compareAtPriceValue;
        productDoc.quantity = Math.max(0, Math.floor(parseNonNegativeNumber(req.body.productQuantity)));

        if (resolvedImagePath) {
          productDoc.imageUrl = resolvedImagePath;
          productDoc.images = catalogService.normalizeImageList([resolvedImagePath, ...(productDoc.images || [])], resolvedImagePath);
        }

        productDoc.searchKeywords = [categoryDoc.name, productName];
        await productDoc.save();
        catalogService.clearCatalogContextCache();

        const productDto = await loadProductDtoById(productDoc.legacyId || String(productDoc._id));
        return { ok: true, productId: productDoc.legacyId || String(productDoc._id), product: productDto };
      });

      if (!mutationResult.ok) return sendError(mutationResult.errorCode || 'save-failed', mutationResult.message || 'Failed to update product', mutationResult.statusCode || 500);

      if (isAjax) return res.json({ success: true, message: 'Product updated successfully', productId: mutationResult.productId, product: mutationResult.product });
      return res.redirect(buildStatusRedirect(redirectPath, 'product-updated'));

    } catch (err) {
      console.error('[ERROR]', {
        route: req && req.originalUrl ? req.originalUrl : '',
        method: req && req.method ? req.method : '',
        name: err && err.name ? String(err.name) : 'Error',
        message: err && err.message ? String(err.message) : 'Product edit failed',
        stack: err && err.stack ? String(err.stack) : '',
        timestamp: new Date().toISOString(),
      });

      if (isDuplicateKeyError(err)) {
        return sendError('duplicate-product', 'Product already exists', 409);
      }
      return sendError('save-failed', 'Unexpected error occurred', 500);
    }
  });
}

async function deleteProduct(req, res) {
  let productId = catalogService.toTrimmedString(req.body.productId);
  let redirectPath = getSafeRedirectPath(req, defaultAdminPath);
  let isAjax = isAjaxRequest(req);
  let mutationResult = null;

  if (!await ensureDatabaseConnection()) {
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
    let productDoc = await Product.findOneAndDelete(buildProductIdentifierFilter(productId));

    if (!productDoc) {
      return {
        ok: false,
        errorCode: 'product-not-found',
        message: 'Product not found',
        statusCode: 404,
      };
    }

    catalogService.clearCatalogContextCache();

    return {
      ok: true,
      productId: productDoc.legacyId || String(productDoc._id),
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
  let categoryName = normalizeSingleLineText(req.body.categoryName);
  let redirectPath = getSafeRedirectPath(req, defaultAdminPath);
  let isAjax = isAjaxRequest(req);
  let mutationResult = null;

  if (!await ensureDatabaseConnection()) {
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
    let categoryDoc = await findCategoryDocByName(categoryName);

    if (!categoryDoc) {
      return {
        ok: false,
        errorCode: 'category-not-found',
        message: 'Category not found',
        statusCode: 404,
      };
    }

    await Product.deleteMany({ category: categoryDoc._id });
    await Category.deleteOne({ _id: categoryDoc._id });
    catalogService.clearCatalogContextCache();

    return {
      ok: true,
      categoryName: categoryDoc.name,
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
  let requestBody = req && req.body && typeof req.body === 'object' ? req.body : {};
  let categoryName = normalizeSingleLineText(req.body.categoryName);
  let originalCategoryName = normalizeSingleLineText(req.body.originalCategoryName);
  let categoryDescription = normalizeMultilineText(req.body.categoryDescription);
  let parsedCategoryItems = catalogService.parseCommaSeparatedList(req.body.categoryItems);
  let categoryItems = sanitizeCategoryItems(req.body.categoryItems);
  let shouldReplaceCategoryItems = /^(1|true|yes|on)$/i.test(catalogService.toTrimmedString(req.body.replaceCategoryItems));
  let shouldUpdateDescription = Object.prototype.hasOwnProperty.call(requestBody, 'categoryDescription');
  let redirectPath = getSafeRedirectPath(req, defaultAdminPath);
  let isAjax = isAjaxRequest(req);
  let mutationResult = null;
  let successRedirectPath = redirectPath;

  if (!await ensureDatabaseConnection()) {
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
    !isWithinLength(categoryDescription, maxCategoryDescriptionLength) ||
    parsedCategoryItems.length > maxCategoryItemsCount
  ) {
    if (isAjax) {
      return res.status(400).json({ success: false, error: 'invalid-input', message: 'Invalid input' });
    }

    return res.redirect(buildErrorRedirect(redirectPath, 'invalid-input'));
  }

  mutationResult = await runAdminMutation(async function () {
    let existingCategoryDoc = originalCategoryName
      ? await findCategoryDocByName(originalCategoryName)
      : null;
    let duplicateCategoryDoc = await findCategoryDocByName(categoryName);
    let resolvedCategoryDoc = existingCategoryDoc;
    let previousCategoryName = existingCategoryDoc ? existingCategoryDoc.name : '';
    let nextCategoryItems = [];

    if (duplicateCategoryDoc && (!existingCategoryDoc || String(duplicateCategoryDoc._id) !== String(existingCategoryDoc._id))) {
      return {
        ok: false,
        errorCode: 'duplicate-category',
        message: 'Category already exists',
        statusCode: 409,
      };
    }

    if (!resolvedCategoryDoc) {
      resolvedCategoryDoc = new Category({
        name: categoryName,
      });
    }

    nextCategoryItems = shouldReplaceCategoryItems
      ? categoryItems
      : catalogService.normalizeList((resolvedCategoryDoc.items || []).concat(categoryItems));

    resolvedCategoryDoc.name = categoryName;
    resolvedCategoryDoc.items = nextCategoryItems;

    if (shouldUpdateDescription) {
      resolvedCategoryDoc.description = categoryDescription;
    }

    await resolvedCategoryDoc.save();
    catalogService.clearCatalogContextCache();

    return {
      ok: true,
      categoryName: resolvedCategoryDoc.name,
      originalCategoryName: previousCategoryName,
      categoryItems: nextCategoryItems,
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

  successRedirectPath = resolveCategorySaveRedirectPath(
    mutationResult.categoryName,
    redirectPath,
    shouldReplaceCategoryItems
  );

  if (isAjax) {
    return res.json({
      success: true,
      message: 'Category saved successfully',
      categoryName: mutationResult.categoryName,
      originalCategoryName: mutationResult.originalCategoryName || '',
      categoryItems: Array.isArray(mutationResult.categoryItems) ? mutationResult.categoryItems : [],
      redirectPath: successRedirectPath,
    });
  }

  return res.redirect(buildStatusRedirect(successRedirectPath, 'category-saved'));
}

async function revertOrderToPending(orderId, adminMessage) {
  try {
    await Order.updateOne(
      { _id: orderId, adminStatus: 'processing' },
      {
        $set: {
          adminStatus: 'pending',
          adminMessage: adminMessage || '',
          adminAcceptedAt: null,
        },
      }
    );
  } catch (error) {
    console.error('Failed to revert processing order:', error.message);
  }
}

async function acceptOrderRequest(req, res) {
  let requestBody = req && req.body && typeof req.body === 'object' ? req.body : {};
  let orderId = catalogService.toTrimmedString(requestBody.orderId);
  let adminMessage = normalizeMultilineText(requestBody.adminMessage);
  let redirectPath = getSafeRedirectPath(req, defaultAdminOrdersPath);
  let isAjax = isAjaxRequest(req);
  let requestId = req && req.requestId ? String(req.requestId) : '';
  let claimedOrder = null;
  let productDoc = null;
  let updatedProduct = null;
  let acceptedOrder = null;
  let orderQuantity = 1;
  let customerEmail = '';
  let emailSubject = '';
  let productName = '';

  function sendErrorResponse(errorCode, message, statusCode) {
    if (isAjax) {
      return res.status(statusCode || 400).json({
        success: false,
        error: errorCode,
        message: message,
        requestId: requestId,
      });
    }

    return res.redirect(buildErrorRedirect(redirectPath, errorCode));
  }

  function sendSuccessResponse(message, alreadyAccepted) {
    if (isAjax) {
      return res.json({
        success: true,
        message: message,
        orderId: orderId,
        alreadyAccepted: Boolean(alreadyAccepted),
        requestId: requestId,
      });
    }

    return res.redirect(buildStatusRedirect(redirectPath, 'order-accepted'));
  }

  if (!orderId) {
    return sendErrorResponse('order-id-required', 'Order ID required');
  }

  if (!mongoose.isValidObjectId(orderId)) {
    return sendErrorResponse('order-not-found', 'Order not found', 404);
  }

  if (adminMessage.length > maxAdminOrderMessageLength) {
    return sendErrorResponse('invalid-input', 'Message too long');
  }

  if (!await ensureDatabaseConnection()) {
    return sendErrorResponse('db-unavailable', 'Database unavailable', 503);
  }

  if (config.app.isProduction) {
    let session = null;
    let transactionResult = null;

    try {
      session = await mongoose.startSession();

      transactionResult = await session.withTransaction(async function () {
        let claimedOrder = await Order.findOneAndUpdate(
          { _id: orderId, adminStatus: 'pending' },
          {
            $set: {
              adminStatus: 'processing',
              adminMessage: adminMessage,
              adminAcceptedAt: null,
            },
          },
          { returnDocument: 'after', session: session }
        );

        if (!claimedOrder) {
          claimedOrder = await Order.findById(orderId).session(session);

          if (!claimedOrder) {
            return { kind: 'order-not-found' };
          }

          if (catalogService.toTrimmedString(claimedOrder.adminStatus).toLowerCase() === 'accepted') {
            return { kind: 'already-accepted' };
          }

          return { kind: 'already-processing' };
        }

        let orderQuantity = parsePositiveInteger(claimedOrder.quantity, 1);
        let productDoc = null;
        let updatedProduct = null;

        if (claimedOrder.product) {
          productDoc = await Product.findById(claimedOrder.product).session(session);
        }

        if (!productDoc && claimedOrder.productId) {
          productDoc = await Product.findOne(buildProductIdentifierFilter(claimedOrder.productId)).session(session);
        }

        if (productDoc) {
          updatedProduct = await Product.findOneAndUpdate(
            { _id: productDoc._id, quantity: mongoose.trusted({ $gte: orderQuantity }) },
            { $inc: { quantity: -orderQuantity } },
            { returnDocument: 'after', session: session }
          );

          if (!updatedProduct) {
            await Order.updateOne(
              { _id: orderId, adminStatus: 'processing' },
              {
                $set: {
                  adminStatus: 'pending',
                  adminMessage: adminMessage || '',
                  adminAcceptedAt: null,
                },
              },
              { session: session }
            );

            if (Number(productDoc.quantity) < 1) {
              return { kind: 'out-of-stock' };
            }

            return { kind: 'insufficient-stock' };
          }
        }

        let acceptedOrder = await Order.findOneAndUpdate(
          { _id: orderId, adminStatus: 'processing' },
          {
            $set: {
              adminStatus: 'accepted',
              adminMessage: adminMessage,
              adminAcceptedAt: new Date(),
              adminEmailNotificationSent: false,
            },
          },
          { returnDocument: 'after', session: session }
        );

        if (!acceptedOrder) {
          throw new Error('order-accept-update-failed');
        }

        return { kind: 'accepted', order: acceptedOrder };
      }, {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      });

      if (!transactionResult || typeof transactionResult !== 'object' || !transactionResult.kind) {
        throw new Error('order-accept-transaction-failed');
      }

      if (transactionResult.kind === 'order-not-found') {
        return sendErrorResponse('order-not-found', 'Order not found', 404);
      }

      if (transactionResult.kind === 'already-accepted') {
        return sendSuccessResponse('Order already accepted', true);
      }

      if (transactionResult.kind === 'already-processing') {
        return sendErrorResponse('save-failed', 'Order is already being processed', 409);
      }

      if (transactionResult.kind === 'out-of-stock') {
        return sendErrorResponse('out-of-stock', 'Product out of stock', 400);
      }

      if (transactionResult.kind === 'insufficient-stock') {
        return sendErrorResponse('insufficient-stock', 'Insufficient stock', 400);
      }

      if (transactionResult.kind !== 'accepted') {
        throw new Error('order-accept-transaction-invalid-result');
      }

      acceptedOrder = transactionResult.order;
      catalogService.clearCatalogContextCache();

      customerEmail = normalizeEmail(acceptedOrder && acceptedOrder.customerEmail);
      productName = catalogService.toTrimmedString(acceptedOrder && acceptedOrder.productName) || 'Product';
      emailSubject = 'Order accepted: ' + productName;

      if (customerEmail && isLikelyEmailAddress(customerEmail) && acceptedOrder && acceptedOrder._id) {
        Promise.resolve().then(async function () {
          let sendResult = null;
          let refreshedOrder = null;

          try {
            sendResult = await resendService.sendEmail({
              to: customerEmail,
              subject: emailSubject,
              text: buildAdminOrderAcceptedEmailText(acceptedOrder, adminMessage),
              html: buildAdminOrderAcceptedEmailHtml(acceptedOrder, adminMessage),
            });

            if (!sendResult.ok) {
              console.error('Order accepted email failed:', sendResult.errorCode || 'unknown');
              return;
            }

            refreshedOrder = await Order.findById(acceptedOrder._id);
            if (!refreshedOrder) {
              return;
            }

            refreshedOrder.adminEmailNotificationSent = true;
            await refreshedOrder.save();
          } catch (emailError) {
            console.error('Order accepted email async failed:', emailError.message);
          }
        });
      }

      return sendSuccessResponse('Order accepted successfully', false);
    } catch (error) {
      console.error('[ERROR]', {
        route: req && req.originalUrl ? req.originalUrl : '',
        method: req && req.method ? req.method : '',
        name: error && error.name ? String(error.name) : 'Error',
        message: error && error.message ? String(error.message) : 'Order accept transaction failed',
        stack: error && error.stack ? String(error.stack) : '',
        timestamp: new Date().toISOString(),
        requestId: requestId,
        orderId: orderId,
      });

      if (isTransactionNotSupportedError(error)) {
        return sendErrorResponse('db-unavailable', 'Database must support transactions to accept orders', 503);
      }

      return sendErrorResponse('save-failed', 'Failed to process order', 500);
    } finally {
      if (session) {
        session.endSession();
      }
    }
  }

  try {
    claimedOrder = await Order.findOneAndUpdate(
      { _id: orderId, adminStatus: 'pending' },
      {
        $set: {
          adminStatus: 'processing',
          adminMessage: adminMessage,
          adminAcceptedAt: null,
        },
      },
      { returnDocument: 'after' }
    );

    if (!claimedOrder) {
      claimedOrder = await Order.findById(orderId);

      if (!claimedOrder) {
        return sendErrorResponse('order-not-found', 'Order not found', 404);
      }

      if (catalogService.toTrimmedString(claimedOrder.adminStatus).toLowerCase() === 'accepted') {
        return sendSuccessResponse('Order already accepted', true);
      }

      return sendErrorResponse('save-failed', 'Order is already being processed', 409);
    }

    orderQuantity = parsePositiveInteger(claimedOrder.quantity, 1);

    if (claimedOrder.product) {
      productDoc = await Product.findById(claimedOrder.product);
    }

    if (!productDoc && claimedOrder.productId) {
      productDoc = await Product.findOne(buildProductIdentifierFilter(claimedOrder.productId));
    }

    if (productDoc) {
      updatedProduct = await Product.findOneAndUpdate(
        { _id: productDoc._id, quantity: mongoose.trusted({ $gte: orderQuantity }) },
        { $inc: { quantity: -orderQuantity } },
        { returnDocument: 'after' }
      );

      if (!updatedProduct) {
        await revertOrderToPending(orderId, adminMessage);

        if (Number(productDoc.quantity) < 1) {
          return sendErrorResponse('out-of-stock', 'Product out of stock', 400);
        }

        return sendErrorResponse('insufficient-stock', 'Insufficient stock', 400);
      }
    }

    acceptedOrder = await Order.findOneAndUpdate(
      { _id: orderId, adminStatus: 'processing' },
      {
        $set: {
          adminStatus: 'accepted',
          adminMessage: adminMessage,
          adminAcceptedAt: new Date(),
          adminEmailNotificationSent: false,
        },
      },
      { returnDocument: 'after' }
    );

    if (!acceptedOrder) {
      throw new Error('order-accept-update-failed');
    }

    catalogService.clearCatalogContextCache();

    customerEmail = normalizeEmail(acceptedOrder && acceptedOrder.customerEmail);
    productName = catalogService.toTrimmedString(acceptedOrder && acceptedOrder.productName) || 'Product';
    emailSubject = 'Order accepted: ' + productName;

    if (customerEmail && isLikelyEmailAddress(customerEmail) && acceptedOrder && acceptedOrder._id) {
      Promise.resolve().then(async function () {
        let sendResult = null;
        let refreshedOrder = null;

        try {
          sendResult = await resendService.sendEmail({
            to: customerEmail,
            subject: emailSubject,
            text: buildAdminOrderAcceptedEmailText(acceptedOrder, adminMessage),
            html: buildAdminOrderAcceptedEmailHtml(acceptedOrder, adminMessage),
          });

          if (!sendResult.ok) {
            console.error('Order accepted email failed:', sendResult.errorCode || 'unknown');
            return;
          }

          refreshedOrder = await Order.findById(acceptedOrder._id);
          if (!refreshedOrder) {
            return;
          }

          refreshedOrder.adminEmailNotificationSent = true;
          await refreshedOrder.save();
        } catch (emailError) {
          console.error('Order accepted email async failed:', emailError.message);
        }
      });
    }

    return sendSuccessResponse('Order accepted successfully', false);
  } catch (error) {
    console.error('[ERROR]', {
      route: req && req.originalUrl ? req.originalUrl : '',
      method: req && req.method ? req.method : '',
      name: error && error.name ? String(error.name) : 'Error',
      message: error && error.message ? String(error.message) : 'Order accept action failed',
      stack: error && error.stack ? String(error.stack) : '',
      timestamp: new Date().toISOString(),
      requestId: requestId,
      orderId: orderId,
    });
    if (updatedProduct && updatedProduct._id && !acceptedOrder) {
      try {
        await Product.updateOne({ _id: updatedProduct._id }, { $inc: { quantity: orderQuantity } });
      } catch (restoreError) {
        console.error('Failed to restore product stock after order accept failure:', restoreError.message);
      }
    }
    await revertOrderToPending(orderId, adminMessage);
    return sendErrorResponse('save-failed', 'Failed to process order', 500);
  }
}

async function deleteOrderRequest(req, res) {
  let requestBody = req && req.body && typeof req.body === 'object' ? req.body : {};
  let orderId = catalogService.toTrimmedString(requestBody.orderId);
  let redirectPath = getSafeRedirectPath(req, defaultAdminOrdersPath);
  let isAjax = isAjaxRequest(req);
  let deletedOrder = null;

  function sendErrorResponse(errorCode, message, statusCode) {
    if (isAjax) {
      return res.status(statusCode || 400).json({ success: false, error: errorCode, message: message });
    }

    return res.redirect(buildErrorRedirect(redirectPath, errorCode));
  }

  if (!orderId) {
    return sendErrorResponse('order-id-required', 'Order ID required');
  }

  if (!mongoose.isValidObjectId(orderId)) {
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
    console.error('[ERROR]', {
      route: req && req.originalUrl ? req.originalUrl : '',
      method: req && req.method ? req.method : '',
      name: error && error.name ? String(error.name) : 'Error',
      message: error && error.message ? String(error.message) : 'Order delete action failed',
      stack: error && error.stack ? String(error.stack) : '',
      timestamp: new Date().toISOString(),
      orderId: orderId,
    });
    return sendErrorResponse('save-failed', 'Failed to delete order', 500);
  }
}

function saveProduct(req, res) {
  catalogService.imageUpload.single('productImageFile')(req, res, async function (uploadError) {
    let redirectPath = getSafeRedirectPath(req, defaultAdminPath);
    let isAjax = isAjaxRequest(req);
    let mutationResult = null;
    let uploadedImagePath = '';

    function sendErrorResponse(errorCode, message, statusCode) {
      if (uploadedImagePath) {
        catalogService.cleanupLocalImageAsset(uploadedImagePath).catch(function (error) {
          console.error('Failed to cleanup rejected uploaded image:', error.message);
        });
      }

      if (!uploadedImagePath && req && req.file && req.file.path) {
        fs.promises.unlink(req.file.path).catch(function (error) {
          if (error && error.code !== 'ENOENT') {
            console.error('Failed to cleanup rejected upload:', error.message);
          }
        });
      }

      if (isAjax) {
        return res.status(statusCode || 400).json({ success: false, error: errorCode, message: message });
      }

      return res.redirect(buildErrorRedirect(redirectPath, errorCode));
    }

    if (uploadError) {
      return sendErrorResponse(
        uploadError.code === 'LIMIT_FILE_SIZE' ? 'image-too-large' : 'invalid-image-file',
        uploadError.code === 'LIMIT_FILE_SIZE' ? 'Image too large' : 'Invalid image file',
        400
      );
    }

    if (!req.file) {
      return sendErrorResponse('product-image-file-required', 'Product image required', 400);
    }

    try {
      if (!await ensureDatabaseConnection()) {
        return sendErrorResponse('db-unavailable', 'Database unavailable', 503);
      }

      let categoryName = normalizeSingleLineText(req.body.productCategory);
      let productName = normalizeSingleLineText(req.body.productName);
      let rawProductSpec = normalizeMultilineText(req.body.productSpec);
      let productSpec = buildProductSpec(categoryName, rawProductSpec);
      let productPricing = resolveProductPricing(req.body.productPrice, req.body.productDiscountPercent);

      if (!categoryName || !isWithinLength(categoryName, maxCategoryNameLength)) {
        return sendErrorResponse('product-category-required', 'Product category required', 400);
      }

      if (!productName || !isWithinLength(productName, maxProductNameLength)) {
        return sendErrorResponse('product-name-required', 'Product name required', 400);
      }

      if (!hasValidPriceValue(req.body.productPrice) || productPricing.isPriceMissing || !Number.isFinite(productPricing.priceValue)) {
        return sendErrorResponse('product-price-required', 'Valid price required', 400);
      }

      if (!isWithinLength(rawProductSpec, maxProductSpecLength) || !hasValidQuantityValue(req.body.productQuantity)) {
        return sendErrorResponse('invalid-input', 'Invalid input', 400);
      }

      uploadedImagePath = await catalogService.optimizeAndPromoteUploadedImage(req.file);

      if (!uploadedImagePath) {
        return sendErrorResponse('invalid-image-file', 'Image upload failed', 400);
      }

      mutationResult = await runAdminMutation(async function () {
        let categoryDoc = await findOrCreateCategoryDocByName(categoryName);
        let duplicateProduct = null;
        let legacyId = '';
        let createdProduct = null;
        let productDto = null;

        if (!categoryDoc) {
          return {
            ok: false,
            errorCode: 'category-not-found',
            message: 'Category not found',
            statusCode: 404,
          };
        }

        duplicateProduct = await Product.findOne({
          category: categoryDoc._id,
          normalizedName: catalogService.normalizeForSearch(productName),
        }).select('_id');

        if (duplicateProduct) {
          return {
            ok: false,
            errorCode: 'duplicate-product',
            message: 'Product already exists',
            statusCode: 409,
          };
        }

        legacyId = await catalogService.buildUniqueProductLegacyId(categoryDoc.name, productName);

        try {
          createdProduct = await Product.create({
            legacyId: legacyId,
            category: categoryDoc._id,
            name: productName,
            description: productSpec,
            spec: productSpec,
            price: productPricing.priceValue,
            compareAtPrice: productPricing.compareAtPriceValue,
            quantity: Math.max(0, Math.floor(parseNonNegativeNumber(req.body.productQuantity))),
            imageUrl: uploadedImagePath,
            images: catalogService.normalizeImageList([uploadedImagePath], uploadedImagePath),
            searchKeywords: [categoryDoc.name, productName],
            status: 'active',
            isActive: true,
          });
        } catch (error) {
          if (isDuplicateKeyError(error)) {
            return {
              ok: false,
              errorCode: 'duplicate-product',
              message: 'Product already exists',
              statusCode: 409,
            };
          }

          throw error;
        }

        catalogService.clearCatalogContextCache();
        productDto = await loadProductDtoById(createdProduct.legacyId || String(createdProduct._id));

        return {
          ok: true,
          product: productDto,
        };
      });

      if (!mutationResult || !mutationResult.ok) {
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
    } catch (error) {
      console.error('[ERROR]', {
        route: req && req.originalUrl ? req.originalUrl : '',
        method: req && req.method ? req.method : '',
        message: error && error.message ? error.message : 'Unknown error',
        stack: error && error.stack ? error.stack : '',
        timestamp: new Date().toISOString(),
      });

      if (res.headersSent) {
        return;
      }

      return sendErrorResponse('save-failed', 'Failed to save product', 500);
    }
  });
}
export default {
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
