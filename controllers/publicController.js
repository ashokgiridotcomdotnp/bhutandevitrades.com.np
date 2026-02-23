var crypto = require('crypto');
var catalogService = require('../services/catalogService');
var database = require('../lib/db');
var userAuth = require('../lib/userAuth');
var resendService = require('../services/resendService');
var User = require('../models/User');
var Order = require('../models/Order');
var UserAuthCode = require('../models/UserAuthCode');

var storefrontPageSize = 10;
var authCodeTtlMinutes = 10;
var authCodeTtlMs = authCodeTtlMinutes * 60 * 1000;
var maxUserNameLength = 120;
var minPasswordLength = 6;

function toTrimmedString(value) {
  return String(value || '').trim();
}

function normalizeEmail(value) {
  return toTrimmedString(value).toLowerCase();
}

function isValidEmailAddress(email) {
  return isLikelyEmailAddress(normalizeEmail(email));
}

function getStoreWhatsappNumber() {
  var rawValue = String(process.env.STORE_WHATSAPP_NUMBER || process.env.WHATSAPP_NUMBER || '').trim();
  return rawValue.replace(/[^0-9]/g, '');
}

function getOrderNotificationEmail() {
  return normalizeEmail(
    process.env.ORDER_NOTIFICATION_EMAIL
    || process.env.ORDER_GMAIL
    || process.env.STORE_ORDER_EMAIL
  );
}

function isLikelyEmailAddress(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toTrimmedString(value));
}

function sanitizeText(value, maxLength) {
  var cleanValue = toTrimmedString(value);
  var limit = Number(maxLength);

  if (Number.isFinite(limit) && limit > 0 && cleanValue.length > limit) {
    return cleanValue.slice(0, limit);
  }

  return cleanValue;
}

function normalizeOrderPhone(value) {
  var digits = String(value || '').replace(/[^0-9]/g, '');

  if (digits.indexOf('977') === 0 && digits.length === 13) {
    return digits.slice(3);
  }

  return digits;
}

function isValidOrderPhone(value) {
  return /^9[0-9]{9}$/.test(normalizeOrderPhone(value));
}

function parsePositiveNumber(value) {
  var normalizedValue = String(value || '').replace(/,/g, '').replace(/[^0-9.]/g, '');
  var parsedValue = Number(normalizedValue);

  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return 0;
  }

  return parsedValue;
}

function formatNprAmount(value) {
  var parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return '0';
  }

  return parsedValue.toLocaleString('en-IN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
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

function buildOrderWhatsappMessage(orderData) {
  var lines = [];

  lines.push('Hello, I want to place an order.');
  lines.push('');
  lines.push('Product: ' + orderData.productName);
  lines.push('Category: ' + orderData.productType);
  lines.push('Quantity: ' + orderData.quantity);
  lines.push('Unit Price: ' + orderData.unitPriceLabel);
  lines.push('Total: ' + orderData.totalLabel);

  if (orderData.customerName) {
    lines.push('Customer: ' + orderData.customerName);
  }

  if (orderData.phoneNumber) {
    lines.push('Phone: ' + orderData.phoneNumber);
  }

  if (orderData.customerEmail) {
    lines.push('Email: ' + orderData.customerEmail);
  }

  if (orderData.note) {
    lines.push('Note: ' + orderData.note);
  }

  return lines.join('\n');
}

function buildOrderNotificationText(orderData) {
  return [
    'New order request received.',
    '',
    'Product: ' + orderData.productName,
    'Category: ' + orderData.productType,
    'Quantity: ' + orderData.quantity,
    'Unit Price: ' + orderData.unitPriceLabel,
    'Total: ' + orderData.totalLabel,
    'Customer Name: ' + (orderData.customerName || '-'),
    'Phone: ' + (orderData.phoneNumber || '-'),
    'Email: ' + (orderData.customerEmail || '-'),
    'Note: ' + (orderData.note || '-'),
    'Requested At: ' + new Date().toISOString(),
  ].join('\n');
}

function buildOrderNotificationHtml(orderData) {
  return [
    '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a;">',
    '<h2 style="margin:0 0 12px;">New order request received</h2>',
    '<table cellpadding="6" cellspacing="0" style="border-collapse:collapse;">',
    '<tr><td><strong>Product</strong></td><td>' + escapeHtml(orderData.productName) + '</td></tr>',
    '<tr><td><strong>Category</strong></td><td>' + escapeHtml(orderData.productType) + '</td></tr>',
    '<tr><td><strong>Quantity</strong></td><td>' + escapeHtml(orderData.quantity) + '</td></tr>',
    '<tr><td><strong>Unit Price</strong></td><td>' + escapeHtml(orderData.unitPriceLabel) + '</td></tr>',
    '<tr><td><strong>Total</strong></td><td>' + escapeHtml(orderData.totalLabel) + '</td></tr>',
    '<tr><td><strong>Customer Name</strong></td><td>' + escapeHtml(orderData.customerName || '-') + '</td></tr>',
    '<tr><td><strong>Phone</strong></td><td>' + escapeHtml(orderData.phoneNumber || '-') + '</td></tr>',
    '<tr><td><strong>Email</strong></td><td>' + escapeHtml(orderData.customerEmail || '-') + '</td></tr>',
    '<tr><td><strong>Note</strong></td><td>' + escapeHtml(orderData.note || '-') + '</td></tr>',
    '<tr><td><strong>Requested At</strong></td><td>' + escapeHtml(new Date().toISOString()) + '</td></tr>',
    '</table>',
    '</div>',
  ].join('');
}

function parsePositiveInteger(value, fallbackValue) {
  var parsedValue = Number(value);

  if (!Number.isFinite(parsedValue) || parsedValue < 1) {
    return fallbackValue;
  }

  return Math.floor(parsedValue);
}

function parseAvailableStockQuantity(value) {
  var cleanValue = toTrimmedString(value);
  var parsedValue = Number(cleanValue);

  if (!cleanValue) {
    return null;
  }

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return null;
  }

  return Math.floor(parsedValue);
}

function buildLoginRedirectPath(statusCode, errorCode, email) {
  var params = [];

  if (statusCode) {
    params.push('status=' + encodeURIComponent(statusCode));
  }

  if (errorCode) {
    params.push('error=' + encodeURIComponent(errorCode));
  }

  if (email) {
    params.push('email=' + encodeURIComponent(email));
  }

  return '/login' + (params.length ? '?' + params.join('&') : '');
}

function buildSignupRedirectPath(statusCode, errorCode, email, name) {
  var params = [];

  if (statusCode) {
    params.push('status=' + encodeURIComponent(statusCode));
  }

  if (errorCode) {
    params.push('error=' + encodeURIComponent(errorCode));
  }

  if (email) {
    params.push('email=' + encodeURIComponent(email));
  }

  if (name) {
    params.push('name=' + encodeURIComponent(name));
  }

  return '/signup' + (params.length ? '?' + params.join('&') : '');
}

function buildForgotPasswordRedirectPath(statusCode, errorCode, email) {
  var params = [];

  if (statusCode) {
    params.push('status=' + encodeURIComponent(statusCode));
  }

  if (errorCode) {
    params.push('error=' + encodeURIComponent(errorCode));
  }

  if (email) {
    params.push('email=' + encodeURIComponent(email));
  }

  return '/forgot-password' + (params.length ? '?' + params.join('&') : '');
}

function buildProfileRedirectPath(statusCode, errorCode) {
  var params = [];

  if (statusCode) {
    params.push('status=' + encodeURIComponent(statusCode));
  }

  if (errorCode) {
    params.push('error=' + encodeURIComponent(errorCode));
  }

  return '/profile' + (params.length ? '?' + params.join('&') : '');
}

function buildHomeRedirectPath(statusCode) {
  var params = [];

  if (statusCode) {
    params.push('status=' + encodeURIComponent(statusCode));
  }

  return '/' + (params.length ? '?' + params.join('&') : '');
}

function getAuthCodeHashSecret() {
  return toTrimmedString(process.env.EMAIL_OTP_SECRET)
    || toTrimmedString(process.env.USER_SESSION_SECRET)
    || toTrimmedString(process.env.ADMIN_SESSION_SECRET)
    || 'bd-email-otp-fallback-secret';
}

function generateAuthCode() {
  var code = crypto.randomInt(0, 1000000);
  return String(code).padStart(6, '0');
}

function hashAuthCode(inputCode) {
  return crypto
    .createHmac('sha256', getAuthCodeHashSecret())
    .update(String(inputCode || ''))
    .digest('hex');
}

function timingSafeStringEqual(left, right) {
  var leftBuffer = Buffer.from(String(left || ''), 'utf8');
  var rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function hashUserPassword(password, salt) {
  var cleanPassword = String(password || '');
  var resolvedSalt = toTrimmedString(salt) || crypto.randomBytes(16).toString('hex');
  var passwordHash = crypto.scryptSync(cleanPassword, resolvedSalt, 64).toString('hex');

  return {
    hash: passwordHash,
    salt: resolvedSalt,
  };
}

function doesPasswordMatch(password, salt, expectedHash) {
  var cleanSalt = toTrimmedString(salt);
  var cleanExpectedHash = toTrimmedString(expectedHash);

  if (!cleanSalt || !cleanExpectedHash) {
    return false;
  }

  try {
    var generatedHash = hashUserPassword(password, cleanSalt).hash;
    return timingSafeStringEqual(generatedHash, cleanExpectedHash);
  } catch (error) {
    return false;
  }
}

function buildOtpEmailSubject(purpose, code) {
  if (purpose === 'signup') {
    return 'Your BhutanDevi email verification code: ' + code;
  }

  if (purpose === 'password-reset') {
    return 'Your BhutanDevi password reset code: ' + code;
  }

  return 'Your BhutanDevi login code: ' + code;
}

function buildOtpEmailText(purpose, code) {
  var actionText = 'login';

  if (purpose === 'signup') {
    actionText = 'email verification';
  } else if (purpose === 'password-reset') {
    actionText = 'password reset';
  }

  return [
    'Your BhutanDevi ' + actionText + ' code is: ' + code,
    '',
    'This code expires in ' + authCodeTtlMinutes + ' minutes.',
    'If you did not request this, you can ignore this email.',
  ].join('\n');
}

function buildOtpEmailHtml(purpose, code) {
  var actionText = 'login';

  if (purpose === 'signup') {
    actionText = 'email verification';
  } else if (purpose === 'password-reset') {
    actionText = 'password reset';
  }

  return [
    '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a;">',
    '<h2 style="margin:0 0 10px;">BhutanDevi ' + actionText + ' verification</h2>',
    '<p style="margin:0 0 10px;">Use this code to continue:</p>',
    '<p style="font-size:26px;font-weight:700;letter-spacing:3px;margin:0 0 10px;">' + code + '</p>',
    '<p style="margin:0 0 10px;">This code expires in ' + authCodeTtlMinutes + ' minutes.</p>',
    '<p style="margin:0;">If you did not request this, ignore this email.</p>',
    '</div>',
  ].join('');
}

async function ensureDatabaseConnection() {
  return database.connectToDatabase();
}

async function issueAuthCode(email, purpose, name) {
  var code = generateAuthCode();

  await UserAuthCode.deleteMany({
    email: email,
    purpose: purpose,
    usedAt: null,
  });

  await UserAuthCode.create({
    email: email,
    purpose: purpose,
    name: toTrimmedString(name),
    codeHash: hashAuthCode(code),
    expiresAt: new Date(Date.now() + authCodeTtlMs),
  });

  return code;
}

async function verifyAuthCode(email, purpose, verificationCode) {
  var codeRecord = await UserAuthCode.findOne({
    email: email,
    purpose: purpose,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!codeRecord) {
    return {
      ok: false,
      errorCode: 'code-expired',
      record: null,
    };
  }

  if (hashAuthCode(verificationCode) !== codeRecord.codeHash) {
    return {
      ok: false,
      errorCode: 'invalid-code',
      record: null,
    };
  }

  codeRecord.usedAt = new Date();
  await codeRecord.save();

  return {
    ok: true,
    errorCode: '',
    record: codeRecord,
  };
}

function getLoginStatusMessage(statusCode) {
  if (statusCode === 'logged-out') {
    return 'You have been logged out.';
  }

  if (statusCode === 'password-reset-success') {
    return 'Password reset successful. Please login with your new password.';
  }

  return '';
}

function getLoginErrorMessage(errorCode) {
  if (errorCode === 'invalid-email') {
    return 'Please use a valid email address.';
  }

  if (errorCode === 'invalid-password') {
    return 'Password must be at least ' + minPasswordLength + ' characters.';
  }

  if (errorCode === 'invalid-credentials') {
    return 'Invalid email or password.';
  }

  if (errorCode === 'db-unavailable') {
    return 'Database is unavailable. Please try again later.';
  }

  if (errorCode === 'no-account') {
    return 'No account found. Please sign up first.';
  }

  if (errorCode === 'email-send-failed') {
    return 'Could not send verification email. Check Resend configuration.';
  }

  if (errorCode === 'save-failed') {
    return 'Could not complete login. Please try again.';
  }

  if (errorCode === 'login-required') {
    return 'Please login to place an order.';
  }

  return '';
}

function getSignupStatusMessage(statusCode, email) {
  if (statusCode === 'code-sent') {
    return 'Verification code sent to ' + email + '. Check inbox/spam.';
  }

  return '';
}

function getSignupErrorMessage(errorCode) {
  if (errorCode === 'invalid-name') {
    return 'Please provide your full name.';
  }

  if (errorCode === 'invalid-email') {
    return 'Please use a valid email address.';
  }

  if (errorCode === 'invalid-password') {
    return 'Password must be at least ' + minPasswordLength + ' characters.';
  }

  if (errorCode === 'db-unavailable') {
    return 'Database is unavailable. Please try again later.';
  }

  if (errorCode === 'email-exists') {
    return 'Account already exists. Please use login.';
  }

  if (errorCode === 'email-send-failed') {
    return 'Could not send verification email. Check Resend configuration.';
  }

  if (errorCode === 'no-account') {
    return 'Account was not found. Please sign up again.';
  }

  if (errorCode === 'invalid-code') {
    return 'Invalid verification code.';
  }

  if (errorCode === 'code-expired') {
    return 'Verification code expired. Request a new one.';
  }

  if (errorCode === 'save-failed') {
    return 'Could not complete signup. Please request a new code and try again.';
  }

  return '';
}

function getForgotPasswordStatusMessage(statusCode, email) {
  if (statusCode === 'code-sent') {
    return 'Password reset code sent to ' + email + '. Check inbox/spam.';
  }

  return '';
}

function getForgotPasswordErrorMessage(errorCode) {
  if (errorCode === 'invalid-email') {
    return 'Please use a valid email address.';
  }

  if (errorCode === 'invalid-password') {
    return 'Password must be at least ' + minPasswordLength + ' characters.';
  }

  if (errorCode === 'db-unavailable') {
    return 'Database is unavailable. Please try again later.';
  }

  if (errorCode === 'no-account') {
    return 'No account found with this email.';
  }

  if (errorCode === 'email-send-failed') {
    return 'Could not send reset code. Check Resend configuration.';
  }

  if (errorCode === 'invalid-code') {
    return 'Invalid verification code.';
  }

  if (errorCode === 'code-expired') {
    return 'Verification code expired. Request a new one.';
  }

  if (errorCode === 'save-failed') {
    return 'Could not reset password. Please request a new code and try again.';
  }

  return '';
}

function getProfileStatusMessage(statusCode) {
  if (statusCode === 'name-updated') {
    return 'Your name has been updated.';
  }

  if (statusCode === 'password-updated') {
    return 'Your password has been updated.';
  }

  return '';
}

function getHomeStatusMessage(statusCode) {
  if (statusCode === 'login-success') {
    return 'Login successful. Welcome back.';
  }

  return '';
}

function getProfileErrorMessage(errorCode) {
  if (errorCode === 'invalid-name') {
    return 'Please provide a valid name.';
  }

  if (errorCode === 'invalid-current-password') {
    return 'Current password is incorrect.';
  }

  if (errorCode === 'invalid-new-password') {
    return 'New password must be at least ' + minPasswordLength + ' characters.';
  }

  if (errorCode === 'password-mismatch') {
    return 'New password and confirm password do not match.';
  }

  if (errorCode === 'same-password') {
    return 'New password must be different from current password.';
  }

  if (errorCode === 'user-not-found') {
    return 'Account was not found. Please login again.';
  }

  if (errorCode === 'db-unavailable') {
    return 'Database is unavailable. Please try again later.';
  }

  if (errorCode === 'save-failed') {
    return 'Could not update your profile. Please try again.';
  }

  return '';
}

function isDuplicateKeyError(error) {
  return Boolean(
    error
    && (
      error.code === 11000
      || error.codeName === 'DuplicateKey'
      || String(error.message || '').indexOf('E11000') !== -1
    )
  );
}

function setUserSessionAndRedirectHome(res, user, statusCode) {
  userAuth.setUserAuthCookie(res, {
    _id: user._id,
    email: user.email,
    name: user.name,
  });

  return res.redirect(buildHomeRedirectPath(statusCode));
}

async function findAuthenticatedUserRecord(authenticatedUser) {
  var authUser = authenticatedUser && authenticatedUser.email ? authenticatedUser : null;
  var authUserId = toTrimmedString(authUser ? authUser.id : '');
  var authEmail = normalizeEmail(authUser ? authUser.email : '');
  var userRecord = null;

  if (!authUser) {
    return null;
  }

  if (authUserId) {
    userRecord = await User.findById(authUserId);
  }

  if (!userRecord && authEmail) {
    userRecord = await User.findOne({ email: authEmail });
  }

  return userRecord;
}

function renderHomePage(req, res, next) {
  var catalog = catalogService.getCatalogContext();
  var statusCode = toTrimmedString(req.query.status);
  var q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  var rawCategory = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  var query = q;
  var selectedCategory = catalogService.resolveCategoryName(rawCategory, catalog.categoryGroups);
  var isHomeRoute = req.path === '/home' || req.path === '/home/';
  var isRootRoute = req.path === '/';
  var hasActiveFilters = q.length > 0 || Boolean(selectedCategory);
  var showCarousel = isRootRoute && !hasActiveFilters;
  var basePath = isHomeRoute ? '/home' : '/';
  var categoryGroupsForView = catalogService.buildCategoryViewData(query, selectedCategory, catalog.categoryGroups);
  var filteredProductSections = catalogService.filterProductData(
    query,
    selectedCategory,
    catalog.productSections,
    catalog.categoryKeywordMap
  );
  var openCategoryName = catalogService.getOpenCategoryName(categoryGroupsForView, selectedCategory, query);
  var totalResults = catalogService.countItems(filteredProductSections);
  var totalPages = Math.max(1, Math.ceil(totalResults / storefrontPageSize));
  var currentPage = parsePositiveInteger(req.query.page, 1);

  if (currentPage > totalPages) {
    currentPage = totalPages;
  }

  res.render('index', {
    title: 'BhutanDevi Trade and Suppliers',
    q: q,
    activeCategory: selectedCategory,
    currentPath: req.path,
    currentUser: req.userAuth || null,
    showUserAuthActions: true,
    hasFilters: hasActiveFilters,
    hasQuery: q.length > 0,
    totalResults: totalResults,
    openCategoryName: openCategoryName,
    categoryGroups: categoryGroupsForView,
    productSections: filteredProductSections,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    showCarousel: showCarousel,
    carouselImages: catalogService.homeCarouselImages,
    storeCurrentPage: currentPage,
    storeTotalPages: totalPages,
    storePageSize: storefrontPageSize,
    storeWhatsappNumber: getStoreWhatsappNumber(),
    basePath: basePath,
    statusMessage: getHomeStatusMessage(statusCode),
  });
}

function renderProductDetail(req, res, next) {
  var productId = typeof req.params.productId === 'string' ? req.params.productId.trim() : '';
  var q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  var rawCategory = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  var catalog = catalogService.getCatalogContext();
  var selectedCategory = catalogService.resolveCategoryName(rawCategory, catalog.categoryGroups);
  var categoryGroupsForView = catalogService.buildCategoryViewData(q, selectedCategory, catalog.categoryGroups);
  var openCategoryName = catalogService.getOpenCategoryName(categoryGroupsForView, selectedCategory, q);
  var productMatch = catalogService.findProductById(productId, catalog.productSections);

  if (!productMatch) {
    return next();
  }

  res.render('product-detail', {
    title: productMatch.item.name + ' | BhutanDevi Trade and Suppliers',
    q: q,
    activeCategory: selectedCategory,
    currentPath: req.path,
    currentUser: req.userAuth || null,
    showUserAuthActions: true,
    hasQuery: q.length > 0,
    openCategoryName: openCategoryName,
    categoryGroups: categoryGroupsForView,
    product: productMatch.item,
    sectionTitle: productMatch.sectionTitle,
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    storeWhatsappNumber: getStoreWhatsappNumber(),
    basePath: '/',
  });
}

function renderOrderPage(req, res, next) {
  var authenticatedUser = req.userAuth && req.userAuth.email ? req.userAuth : null;
  var productId = typeof req.params.productId === 'string' ? req.params.productId.trim() : '';
  var q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  var rawCategory = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  var catalog = catalogService.getCatalogContext();
  var selectedCategory = catalogService.resolveCategoryName(rawCategory, catalog.categoryGroups);
  var categoryGroupsForView = catalogService.buildCategoryViewData(q, selectedCategory, catalog.categoryGroups);
  var openCategoryName = catalogService.getOpenCategoryName(categoryGroupsForView, selectedCategory, q);
  var productMatch = null;

  if (!authenticatedUser) {
    return res.redirect(buildLoginRedirectPath('', 'login-required', ''));
  }

  if (!productId) {
    return next();
  }

  productMatch = catalogService.findProductById(productId, catalog.productSections);

  if (!productMatch || !productMatch.item) {
    return next();
  }

  return res.render('order', {
    title: 'Order ' + productMatch.item.name + ' | BhutanDevi Trade and Suppliers',
    q: q,
    activeCategory: selectedCategory,
    currentPath: req.path,
    currentUser: authenticatedUser,
    showUserAuthActions: true,
    hasQuery: q.length > 0,
    openCategoryName: openCategoryName,
    categoryGroups: categoryGroupsForView,
    product: productMatch.item,
    sectionTitle: productMatch.sectionTitle,
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    storeWhatsappNumber: getStoreWhatsappNumber(),
    basePath: '/',
  });
}

function renderLoginPage(req, res) {
  var catalog = catalogService.getCatalogContext();
  var statusCode = toTrimmedString(req.query.status);
  var errorCode = toTrimmedString(req.query.error);
  var email = normalizeEmail(req.query.email);
  var categoryGroupsForView = catalogService.buildCategoryViewData('', '', catalog.categoryGroups);
  var openCategoryName = catalogService.getOpenCategoryName(categoryGroupsForView, '', '');

  if (req.userAuth) {
    return res.redirect('/');
  }

  return res.render('login', {
    title: 'Login | BhutanDevi Trade and Suppliers',
    q: '',
    activeCategory: '',
    currentPath: req.path,
    currentUser: req.userAuth || null,
    showUserAuthActions: true,
    hasQuery: false,
    openCategoryName: openCategoryName,
    categoryGroups: categoryGroupsForView,
    authEmail: email,
    statusMessage: getLoginStatusMessage(statusCode),
    errorMessage: getLoginErrorMessage(errorCode),
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
}

function renderSignupPage(req, res) {
  var catalog = catalogService.getCatalogContext();
  var statusCode = toTrimmedString(req.query.status);
  var errorCode = toTrimmedString(req.query.error);
  var email = normalizeEmail(req.query.email);
  var name = toTrimmedString(req.query.name);
  var requireCode = statusCode === 'code-sent' && Boolean(email);
  var categoryGroupsForView = catalogService.buildCategoryViewData('', '', catalog.categoryGroups);
  var openCategoryName = catalogService.getOpenCategoryName(categoryGroupsForView, '', '');

  if (req.userAuth) {
    return res.redirect('/');
  }

  return res.render('signup', {
    title: 'Sign Up | BhutanDevi Trade and Suppliers',
    q: '',
    activeCategory: '',
    currentPath: req.path,
    currentUser: req.userAuth || null,
    showUserAuthActions: true,
    hasQuery: false,
    openCategoryName: openCategoryName,
    categoryGroups: categoryGroupsForView,
    authEmail: email,
    authName: name,
    requireCode: requireCode,
    statusMessage: getSignupStatusMessage(statusCode, email),
    errorMessage: getSignupErrorMessage(errorCode),
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
}

function renderForgotPasswordPage(req, res) {
  var catalog = catalogService.getCatalogContext();
  var statusCode = toTrimmedString(req.query.status);
  var errorCode = toTrimmedString(req.query.error);
  var email = normalizeEmail(req.query.email);
  var authenticatedUser = req.userAuth && req.userAuth.email ? req.userAuth : null;
  var requireCode = statusCode === 'code-sent' && Boolean(email);
  var categoryGroupsForView = catalogService.buildCategoryViewData('', '', catalog.categoryGroups);
  var openCategoryName = catalogService.getOpenCategoryName(categoryGroupsForView, '', '');
  var effectiveEmail = email || normalizeEmail(authenticatedUser ? authenticatedUser.email : '');

  return res.render('forgot-password', {
    title: 'Forgot Password | BhutanDevi Trade and Suppliers',
    q: '',
    activeCategory: '',
    currentPath: req.path,
    currentUser: req.userAuth || null,
    showUserAuthActions: true,
    hasQuery: false,
    openCategoryName: openCategoryName,
    categoryGroups: categoryGroupsForView,
    authEmail: effectiveEmail,
    requireCode: requireCode,
    statusMessage: getForgotPasswordStatusMessage(statusCode, effectiveEmail),
    errorMessage: getForgotPasswordErrorMessage(errorCode),
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
}

async function renderMyOrdersPage(req, res) {
  var catalog = catalogService.getCatalogContext();
  var categoryGroupsForView = catalogService.buildCategoryViewData('', '', catalog.categoryGroups);
  var openCategoryName = catalogService.getOpenCategoryName(categoryGroupsForView, '', '');
  var authenticatedUser = req.userAuth && req.userAuth.email ? req.userAuth : null;
  var authenticatedUserId = toTrimmedString(authenticatedUser ? authenticatedUser.id : '');
  var authenticatedEmail = normalizeEmail(authenticatedUser ? authenticatedUser.email : '');
  var orders = [];
  var ordersLoadError = '';
  var orderQuery = {};

  if (!authenticatedUser) {
    return res.redirect(buildLoginRedirectPath('', 'login-required', ''));
  }

  if (authenticatedUserId && authenticatedEmail) {
    orderQuery = {
      $or: [
        { userId: authenticatedUserId },
        { customerEmail: authenticatedEmail },
      ],
    };
  } else if (authenticatedUserId) {
    orderQuery = { userId: authenticatedUserId };
  } else {
    orderQuery = { customerEmail: authenticatedEmail };
  }

  try {
    if (!await ensureDatabaseConnection()) {
      ordersLoadError = 'Could not load your order history right now. Please try again later.';
    } else {
      orders = await Order.find(orderQuery)
        .sort({ createdAt: -1 })
        .limit(200)
        .lean();
    }
  } catch (error) {
    console.error('My orders page load failed:', error.message);
    ordersLoadError = 'Could not load your order history right now. Please try again later.';
  }

  return res.render('my-orders', {
    title: 'My Orders | BhutanDevi Trade and Suppliers',
    q: '',
    activeCategory: '',
    currentPath: req.path,
    currentUser: req.userAuth || null,
    showUserAuthActions: true,
    hasQuery: false,
    openCategoryName: openCategoryName,
    categoryGroups: categoryGroupsForView,
    orders: orders,
    ordersLoadError: ordersLoadError,
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
}

async function renderProfilePage(req, res) {
  var authenticatedUser = req.userAuth && req.userAuth.email ? req.userAuth : null;
  var catalog = catalogService.getCatalogContext();
  var statusCode = toTrimmedString(req.query.status);
  var errorCode = toTrimmedString(req.query.error);
  var categoryGroupsForView = catalogService.buildCategoryViewData('', '', catalog.categoryGroups);
  var openCategoryName = catalogService.getOpenCategoryName(categoryGroupsForView, '', '');
  var statusMessage = getProfileStatusMessage(statusCode);
  var errorMessage = getProfileErrorMessage(errorCode);
  var userRecord = null;
  var profileName = sanitizeText(authenticatedUser ? authenticatedUser.name : '', maxUserNameLength);
  var profileEmail = normalizeEmail(authenticatedUser ? authenticatedUser.email : '');
  var hasConnectedDb = false;

  if (!authenticatedUser) {
    return res.redirect(buildLoginRedirectPath('', 'login-required', ''));
  }

  try {
    hasConnectedDb = await ensureDatabaseConnection();

    if (hasConnectedDb) {
      userRecord = await findAuthenticatedUserRecord(authenticatedUser);

      if (userRecord) {
        profileName = sanitizeText(userRecord.name, maxUserNameLength);
        profileEmail = normalizeEmail(userRecord.email);
      } else if (!errorMessage) {
        errorMessage = getProfileErrorMessage('user-not-found');
      }
    } else if (!errorMessage) {
      errorMessage = getProfileErrorMessage('db-unavailable');
    }
  } catch (error) {
    console.error('Profile page load failed:', error.message);
    if (!errorMessage) {
      errorMessage = getProfileErrorMessage('save-failed');
    }
  }

  return res.render('profile', {
    title: 'Profile | BhutanDevi Trade and Suppliers',
    q: '',
    activeCategory: '',
    currentPath: req.path,
    currentUser: authenticatedUser,
    showUserAuthActions: true,
    hasQuery: false,
    openCategoryName: openCategoryName,
    categoryGroups: categoryGroupsForView,
    statusMessage: statusMessage,
    errorMessage: errorMessage,
    profileName: profileName,
    profileEmail: profileEmail,
    minPasswordLength: minPasswordLength,
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
}

async function handleProfileNameUpdate(req, res) {
  var authenticatedUser = req.userAuth && req.userAuth.email ? req.userAuth : null;
  var name = sanitizeText(req.body.name, maxUserNameLength);
  var userRecord = null;

  if (!authenticatedUser) {
    return res.redirect(buildLoginRedirectPath('', 'login-required', ''));
  }

  if (!name) {
    return res.redirect(buildProfileRedirectPath('', 'invalid-name'));
  }

  try {
    if (!await ensureDatabaseConnection()) {
      return res.redirect(buildProfileRedirectPath('', 'db-unavailable'));
    }

    userRecord = await findAuthenticatedUserRecord(authenticatedUser);

    if (!userRecord) {
      return res.redirect(buildProfileRedirectPath('', 'user-not-found'));
    }

    userRecord.name = name;
    await userRecord.save();
    userAuth.setUserAuthCookie(res, {
      _id: userRecord._id,
      email: userRecord.email,
      name: userRecord.name,
    });

    return res.redirect(buildProfileRedirectPath('name-updated', ''));
  } catch (error) {
    console.error('Profile name update failed:', error.message);
    return res.redirect(buildProfileRedirectPath('', 'save-failed'));
  }
}

async function handleProfilePasswordUpdate(req, res) {
  var authenticatedUser = req.userAuth && req.userAuth.email ? req.userAuth : null;
  var currentPassword = toTrimmedString(req.body.currentPassword);
  var newPassword = toTrimmedString(req.body.newPassword);
  var confirmPassword = toTrimmedString(req.body.confirmPassword);
  var userRecord = null;
  var passwordPayload = null;

  if (!authenticatedUser) {
    return res.redirect(buildLoginRedirectPath('', 'login-required', ''));
  }

  if (!currentPassword) {
    return res.redirect(buildProfileRedirectPath('', 'invalid-current-password'));
  }

  if (!newPassword || newPassword.length < minPasswordLength) {
    return res.redirect(buildProfileRedirectPath('', 'invalid-new-password'));
  }

  if (newPassword !== confirmPassword) {
    return res.redirect(buildProfileRedirectPath('', 'password-mismatch'));
  }

  try {
    if (!await ensureDatabaseConnection()) {
      return res.redirect(buildProfileRedirectPath('', 'db-unavailable'));
    }

    userRecord = await findAuthenticatedUserRecord(authenticatedUser);

    if (!userRecord) {
      return res.redirect(buildProfileRedirectPath('', 'user-not-found'));
    }

    if (!doesPasswordMatch(currentPassword, userRecord.passwordSalt, userRecord.passwordHash)) {
      return res.redirect(buildProfileRedirectPath('', 'invalid-current-password'));
    }

    if (doesPasswordMatch(newPassword, userRecord.passwordSalt, userRecord.passwordHash)) {
      return res.redirect(buildProfileRedirectPath('', 'same-password'));
    }

    passwordPayload = hashUserPassword(newPassword);
    userRecord.passwordHash = passwordPayload.hash;
    userRecord.passwordSalt = passwordPayload.salt;
    userRecord.authProvider = 'email-password';
    await userRecord.save();
    userAuth.setUserAuthCookie(res, {
      _id: userRecord._id,
      email: userRecord.email,
      name: userRecord.name,
    });

    return res.redirect(buildProfileRedirectPath('password-updated', ''));
  } catch (error) {
    console.error('Profile password update failed:', error.message);
    return res.redirect(buildProfileRedirectPath('', 'save-failed'));
  }
}

async function handleLoginSubmit(req, res) {
  var email = normalizeEmail(req.body.email);
  var password = toTrimmedString(req.body.password);
  var user = null;
  var code = '';
  var sendResult = null;

  if (!email || !isValidEmailAddress(email)) {
    return res.redirect(buildLoginRedirectPath('', 'invalid-email', email));
  }

  if (!password || password.length < minPasswordLength) {
    return res.redirect(buildLoginRedirectPath('', 'invalid-password', email));
  }

  if (!await ensureDatabaseConnection()) {
    return res.redirect(buildLoginRedirectPath('', 'db-unavailable', email));
  }

  user = await User.findOne({ email: email });

  if (!user) {
    return res.redirect(buildLoginRedirectPath('', 'no-account', email));
  }

  if (!doesPasswordMatch(password, user.passwordSalt, user.passwordHash)) {
    return res.redirect(buildLoginRedirectPath('', 'invalid-credentials', email));
  }

  if (!user.isEmailVerified) {
    try {
      code = await issueAuthCode(email, 'signup', user.name);
      sendResult = await resendService.sendEmail({
        to: email,
        subject: buildOtpEmailSubject('signup', code),
        html: buildOtpEmailHtml('signup', code),
        text: buildOtpEmailText('signup', code),
      });

      if (!sendResult.ok) {
        console.error('Resend login verification email failed:', sendResult.errorCode || 'unknown');
        return res.redirect(buildLoginRedirectPath('', 'email-send-failed', email));
      }

      return res.redirect(buildSignupRedirectPath('code-sent', '', email, user.name));
    } catch (error) {
      console.error('Login verification email issue failed:', error.message);
      return res.redirect(buildLoginRedirectPath('', 'save-failed', email));
    }
  }

  try {
    user.lastLoginAt = new Date();
    await user.save();
    return setUserSessionAndRedirectHome(res, user, 'login-success');
  } catch (error) {
    console.error('Login save failed:', error.message);
    return res.redirect(buildLoginRedirectPath('', 'save-failed', email));
  }
}

async function handleSignupSubmit(req, res) {
  var name = toTrimmedString(req.body.name);
  var email = normalizeEmail(req.body.email);
  var password = toTrimmedString(req.body.password);
  var verificationCode = toTrimmedString(req.body.verificationCode).replace(/\s+/g, '');
  var existingUser = null;
  var code = '';
  var sendResult = null;
  var verificationResult = null;
  var passwordPayload = null;

  if (!name || name.length > maxUserNameLength) {
    return res.redirect(buildSignupRedirectPath('', 'invalid-name', email, name));
  }

  if (!email || !isValidEmailAddress(email)) {
    return res.redirect(buildSignupRedirectPath('', 'invalid-email', email, name));
  }

  if (!await ensureDatabaseConnection()) {
    return res.redirect(buildSignupRedirectPath('', 'db-unavailable', email, name));
  }

  existingUser = await User.findOne({ email: email });

  if (!verificationCode) {
    if (!password || password.length < minPasswordLength) {
      return res.redirect(buildSignupRedirectPath('', 'invalid-password', email, name));
    }

    try {
      passwordPayload = hashUserPassword(password);

      if (existingUser && existingUser.isEmailVerified) {
        return res.redirect(buildSignupRedirectPath('', 'email-exists', email, name));
      }

      if (!existingUser) {
        try {
          existingUser = await User.create({
            email: email,
            name: name,
            authProvider: 'email-password',
            passwordHash: passwordPayload.hash,
            passwordSalt: passwordPayload.salt,
            isEmailVerified: false,
            lastLoginAt: null,
          });
        } catch (saveError) {
          if (isDuplicateKeyError(saveError)) {
            existingUser = await User.findOne({ email: email });
          } else {
            throw saveError;
          }
        }
      }

      if (!existingUser) {
        throw new Error('signup-user-upsert-failed');
      }

      if (existingUser.isEmailVerified) {
        return res.redirect(buildSignupRedirectPath('', 'email-exists', email, name));
      }

      existingUser.name = name;
      existingUser.authProvider = 'email-password';
      existingUser.passwordHash = passwordPayload.hash;
      existingUser.passwordSalt = passwordPayload.salt;
      existingUser.isEmailVerified = false;
      existingUser.lastLoginAt = null;
      await existingUser.save();

      code = await issueAuthCode(email, 'signup', name);
      sendResult = await resendService.sendEmail({
        to: email,
        subject: buildOtpEmailSubject('signup', code),
        html: buildOtpEmailHtml('signup', code),
        text: buildOtpEmailText('signup', code),
      });

      if (!sendResult.ok) {
        console.error('Resend signup email failed:', sendResult.errorCode || 'unknown');
        return res.redirect(buildSignupRedirectPath('', 'email-send-failed', email, name));
      }

      return res.redirect(buildSignupRedirectPath('code-sent', '', email, name));
    } catch (error) {
      console.error('Signup code issue failed:', error.message);
      return res.redirect(buildSignupRedirectPath('', 'save-failed', email, name));
    }
  }

  if (password && password.length < minPasswordLength) {
    return res.redirect(buildSignupRedirectPath('code-sent', 'invalid-password', email, name));
  }

  try {
    verificationResult = await verifyAuthCode(email, 'signup', verificationCode);

    if (!verificationResult.ok) {
      return res.redirect(buildSignupRedirectPath('code-sent', verificationResult.errorCode, email, name));
    }

    existingUser = await User.findOne({ email: email });

    if (!existingUser) {
      return res.redirect(buildSignupRedirectPath('', 'no-account', email, name));
    }

    if (password) {
      passwordPayload = hashUserPassword(password);
      existingUser.passwordHash = passwordPayload.hash;
      existingUser.passwordSalt = passwordPayload.salt;
    }

    if (!toTrimmedString(existingUser.passwordHash) || !toTrimmedString(existingUser.passwordSalt)) {
      return res.redirect(buildSignupRedirectPath('code-sent', 'invalid-password', email, name));
    }

    existingUser.name = name;
    existingUser.authProvider = 'email-password';
    existingUser.lastLoginAt = new Date();
    existingUser.isEmailVerified = true;
    await existingUser.save();

    return setUserSessionAndRedirectHome(res, existingUser);
  } catch (error) {
    console.error('Signup verification failed:', error.message);
    return res.redirect(buildSignupRedirectPath('', 'save-failed', email, name));
  }
}

async function handleForgotPasswordSubmit(req, res) {
  var email = normalizeEmail(req.body.email);
  var verificationCode = toTrimmedString(req.body.verificationCode).replace(/\s+/g, '');
  var password = toTrimmedString(req.body.password);
  var existingUser = null;
  var code = '';
  var sendResult = null;
  var verificationResult = null;
  var passwordPayload = null;

  if (!email || !isValidEmailAddress(email)) {
    return res.redirect(buildForgotPasswordRedirectPath('', 'invalid-email', email));
  }

  if (!await ensureDatabaseConnection()) {
    return res.redirect(buildForgotPasswordRedirectPath('', 'db-unavailable', email));
  }

  if (!verificationCode) {
    existingUser = await User.findOne({ email: email });

    if (!existingUser) {
      return res.redirect(buildForgotPasswordRedirectPath('', 'no-account', email));
    }

    try {
      code = await issueAuthCode(email, 'password-reset', existingUser.name);
      sendResult = await resendService.sendEmail({
        to: email,
        subject: buildOtpEmailSubject('password-reset', code),
        html: buildOtpEmailHtml('password-reset', code),
        text: buildOtpEmailText('password-reset', code),
      });

      if (!sendResult.ok) {
        console.error('Resend forgot password email failed:', sendResult.errorCode || 'unknown');
        return res.redirect(buildForgotPasswordRedirectPath('', 'email-send-failed', email));
      }

      return res.redirect(buildForgotPasswordRedirectPath('code-sent', '', email));
    } catch (error) {
      console.error('Forgot password code issue failed:', error.message);
      return res.redirect(buildForgotPasswordRedirectPath('', 'save-failed', email));
    }
  }

  if (!password || password.length < minPasswordLength) {
    return res.redirect(buildForgotPasswordRedirectPath('code-sent', 'invalid-password', email));
  }

  try {
    verificationResult = await verifyAuthCode(email, 'password-reset', verificationCode);

    if (!verificationResult.ok) {
      return res.redirect(buildForgotPasswordRedirectPath('code-sent', verificationResult.errorCode, email));
    }

    existingUser = await User.findOne({ email: email });

    if (!existingUser) {
      return res.redirect(buildForgotPasswordRedirectPath('', 'no-account', email));
    }

    passwordPayload = hashUserPassword(password);
    existingUser.passwordHash = passwordPayload.hash;
    existingUser.passwordSalt = passwordPayload.salt;
    existingUser.authProvider = 'email-password';
    await existingUser.save();

    return res.redirect(buildLoginRedirectPath('password-reset-success', '', email));
  } catch (error) {
    console.error('Forgot password verification failed:', error.message);
    return res.redirect(buildForgotPasswordRedirectPath('', 'save-failed', email));
  }
}

async function handleOrderSubmit(req, res) {
  var authenticatedUser = req.userAuth && req.userAuth.email ? req.userAuth : null;
  var authenticatedUserId = toTrimmedString(authenticatedUser ? authenticatedUser.id : '');
  var productId = sanitizeText(req.body.productId, 180);
  var requestedProductName = sanitizeText(req.body.productName, 180);
  var requestedProductType = sanitizeText(req.body.productType, 120);
  var requestedUnitPriceLabel = sanitizeText(req.body.unitPriceLabel, 120);
  var requestedUnitPriceValue = parsePositiveNumber(req.body.unitPriceValue);
  var rawQuantity = Number(req.body.quantity);
  var quantity = Number.isFinite(rawQuantity) ? Math.floor(rawQuantity) : 0;
  var customerName = sanitizeText(req.body.customerName, 140);
  var phoneNumber = normalizeOrderPhone(sanitizeText(req.body.phoneNumber, 60));
  var customerEmail = normalizeEmail(authenticatedUser ? authenticatedUser.email : '');
  var note = sanitizeText(req.body.note, 1000);
  var notificationEmail = getOrderNotificationEmail();
  var catalog = catalogService.getCatalogContext();
  var productMatch = null;
  var productName = requestedProductName || 'Product';
  var productType = requestedProductType || 'Other';
  var availableStockQuantity = null;
  var unitPriceValue = requestedUnitPriceValue;
  var unitPriceLabel = requestedUnitPriceLabel || 'Contact for price';
  var totalPriceValue = 0;
  var totalLabel = '';
  var emailSubject = '';
  var orderData = null;
  var orderRecord = null;
  var sendResult = null;
  var confirmationResult = null;

  if (!authenticatedUser) {
    return res.status(401).json({
      ok: false,
      errorCode: 'auth-required',
      message: 'Please login to place an order.',
    });
  }

  if (quantity < 1 || quantity > 999) {
    return res.status(400).json({
      ok: false,
      errorCode: 'invalid-quantity',
      message: 'Quantity must be between 1 and 999.',
    });
  }

  if (!customerName || customerName.length < 2) {
    return res.status(400).json({
      ok: false,
      errorCode: 'invalid-customer-name',
      message: 'Customer name is required.',
    });
  }

  if (!phoneNumber || !isValidOrderPhone(phoneNumber)) {
    return res.status(400).json({
      ok: false,
      errorCode: 'invalid-phone-number',
      message: 'Enter a valid phone number.',
    });
  }

  if (!note || note.length < 3) {
    return res.status(400).json({
      ok: false,
      errorCode: 'invalid-note',
      message: 'Note is required.',
    });
  }

  if (!customerEmail || !isLikelyEmailAddress(customerEmail)) {
    return res.status(401).json({
      ok: false,
      errorCode: 'invalid-auth-session',
      message: 'Please login again to place an order.',
    });
  }

  if (!notificationEmail || !isLikelyEmailAddress(notificationEmail)) {
    return res.status(503).json({
      ok: false,
      errorCode: 'order-email-not-configured',
      message: 'Order email is not configured. Please contact the store.',
    });
  }

  if (productId) {
    productMatch = catalogService.findProductById(productId, catalog.productSections);
  }

  if (productMatch && productMatch.item) {
    productName = sanitizeText(productMatch.item.name, 180) || productName;
    productType = sanitizeText(productMatch.item.type, 120) || productType;
    availableStockQuantity = parseAvailableStockQuantity(productMatch.item.quantity);
    unitPriceLabel = sanitizeText(productMatch.item.price, 120) || unitPriceLabel;
    unitPriceValue = parsePositiveNumber(unitPriceLabel) || unitPriceValue;
  }

  if (!productName) {
    return res.status(400).json({
      ok: false,
      errorCode: 'invalid-product',
      message: 'Product is required.',
    });
  }

  if (availableStockQuantity !== null) {
    if (availableStockQuantity < 1) {
      return res.status(400).json({
        ok: false,
        errorCode: 'out-of-stock',
        message: 'This product is currently out of stock.',
      });
    }

    if (quantity > availableStockQuantity) {
      return res.status(400).json({
        ok: false,
        errorCode: 'insufficient-stock',
        message: 'Only ' + availableStockQuantity + ' item(s) are currently in stock.',
      });
    }
  }

  if (unitPriceValue > 0) {
    unitPriceLabel = 'NPR ' + formatNprAmount(unitPriceValue);
    totalPriceValue = quantity * unitPriceValue;
    totalLabel = 'NPR ' + formatNprAmount(totalPriceValue);
  } else {
    totalLabel = 'Contact for price';
  }

  emailSubject = 'New Order: ' + productName + ' x' + quantity;
  orderData = {
    productName: productName,
    productType: productType,
    quantity: quantity,
    unitPriceLabel: unitPriceLabel,
    totalLabel: totalLabel,
    customerName: customerName,
    phoneNumber: phoneNumber,
    customerEmail: customerEmail,
    note: note,
  };

  if (!await ensureDatabaseConnection()) {
    return res.status(503).json({
      ok: false,
      errorCode: 'db-unavailable',
      message: 'Order service is temporarily unavailable. Please try again.',
    });
  }

  try {
    orderRecord = await Order.create({
      userId: authenticatedUserId || customerEmail,
      customerEmail: customerEmail,
      customerName: customerName,
      phoneNumber: phoneNumber,
      note: note,
      productId: productId,
      productName: productName,
      productType: productType,
      quantity: quantity,
      unitPriceLabel: unitPriceLabel,
      unitPriceValue: unitPriceValue > 0 ? unitPriceValue : 0,
      totalLabel: totalLabel,
      totalPriceValue: totalPriceValue > 0 ? totalPriceValue : 0,
      status: 'pending',
      emailNotificationSent: false,
      customerConfirmationSent: false,
    });
  } catch (error) {
    console.error('Order persistence failed:', error.message);
    return res.status(500).json({
      ok: false,
      errorCode: 'order-save-failed',
      message: 'Could not save order right now. Please try again.',
    });
  }

  try {
    sendResult = await resendService.sendEmail({
      to: notificationEmail,
      subject: emailSubject,
      text: buildOrderNotificationText(orderData),
      html: buildOrderNotificationHtml(orderData),
    });

    if (!sendResult.ok) {
      console.error('Order email send failed:', sendResult.errorCode || 'unknown');

      if (orderRecord) {
        orderRecord.status = 'email-failed';
        orderRecord.emailNotificationSent = false;
        orderRecord.customerConfirmationSent = false;
        await orderRecord.save();
      }

      return res.status(502).json({
        ok: false,
        errorCode: 'email-send-failed',
        message: 'Could not send order email. Please try again.',
      });
    }

    if (customerEmail && isLikelyEmailAddress(customerEmail)) {
      confirmationResult = await resendService.sendEmail({
        to: customerEmail,
        subject: 'Order request received: ' + productName,
        text: [
          'Thank you for your order request.',
          '',
          'Product: ' + productName,
          'Quantity: ' + quantity,
          'Total: ' + totalLabel,
          '',
          'Our team will contact you soon.',
        ].join('\n'),
        html: [
          '<div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a;">',
          '<h2 style="margin:0 0 10px;">Order request received</h2>',
          '<p style="margin:0 0 8px;">Thank you for your order request.</p>',
          '<p style="margin:0 0 8px;"><strong>Product:</strong> ' + escapeHtml(productName) + '</p>',
          '<p style="margin:0 0 8px;"><strong>Quantity:</strong> ' + escapeHtml(quantity) + '</p>',
          '<p style="margin:0 0 8px;"><strong>Total:</strong> ' + escapeHtml(totalLabel) + '</p>',
          '<p style="margin:0;">Our team will contact you soon.</p>',
          '</div>',
        ].join(''),
      });

      if (!confirmationResult.ok) {
        console.error('Order customer confirmation failed:', confirmationResult.errorCode || 'unknown');
      }
    }

    if (orderRecord) {
      orderRecord.status = 'submitted';
      orderRecord.emailNotificationSent = true;
      orderRecord.customerConfirmationSent = Boolean(confirmationResult && confirmationResult.ok);
      await orderRecord.save();
    }

    return res.json({
      ok: true,
      message: 'Order received. Email sent successfully.',
      orderId: orderRecord && orderRecord._id ? String(orderRecord._id) : '',
      whatsappMessage: buildOrderWhatsappMessage(orderData),
    });
  } catch (error) {
    console.error('Order submit failed:', error.message);

    if (orderRecord) {
      try {
        orderRecord.status = 'email-failed';
        orderRecord.emailNotificationSent = false;
        orderRecord.customerConfirmationSent = false;
        await orderRecord.save();
      } catch (orderSaveError) {
        console.error('Order failure status update failed:', orderSaveError.message);
      }
    }

    return res.status(500).json({
      ok: false,
      errorCode: 'order-submit-failed',
      message: 'Could not process order right now. Please try again.',
    });
  }
}

function handleUserLogout(req, res) {
  userAuth.clearUserAuthCookie(res);
  return res.redirect('/login?status=logged-out');
}

module.exports = {
  handleForgotPasswordSubmit: handleForgotPasswordSubmit,
  handleOrderSubmit: handleOrderSubmit,
  handleLoginSubmit: handleLoginSubmit,
  handleProfileNameUpdate: handleProfileNameUpdate,
  handleProfilePasswordUpdate: handleProfilePasswordUpdate,
  handleSignupSubmit: handleSignupSubmit,
  handleUserLogout: handleUserLogout,
  renderForgotPasswordPage: renderForgotPasswordPage,
  renderLoginPage: renderLoginPage,
  renderHomePage: renderHomePage,
  renderMyOrdersPage: renderMyOrdersPage,
  renderOrderPage: renderOrderPage,
  renderProfilePage: renderProfilePage,
  renderProductDetail: renderProductDetail,
  renderSignupPage: renderSignupPage,
};
