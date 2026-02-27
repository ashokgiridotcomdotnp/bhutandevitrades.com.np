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
var minUserNameLength = 2;
var maxUserNameLength = 120;
var maxEmailLength = 254;
var minPasswordLength = 6;
var maxPasswordLength = 128;
var verificationCodeLength = 6;
var signupPrefillCookieName = 'bd_signup_prefill';
var signupStateCookieName = 'bd_signup_state';
var signupPrefillCookieTtlMs = 30 * 60 * 1000;
var loginPrefillCookieName = 'bd_login_prefill';
var loginStateCookieName = 'bd_login_state';
var forgotPrefillCookieName = 'bd_forgot_prefill';
var forgotStateCookieName = 'bd_forgot_state';
var profileStateCookieName = 'bd_profile_state';
var homeStateCookieName = 'bd_home_state';

function toTrimmedString(value) {
  return String(value || '').trim();
}

function normalizeBooleanEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function normalizeEmail(value) {
  return toTrimmedString(value).toLowerCase();
}

function isValidEmailAddress(email) {
  var normalizedEmail = normalizeEmail(email);
  return normalizedEmail.length <= maxEmailLength && isLikelyEmailAddress(normalizedEmail);
}

function isPasswordLengthValid(password) {
  var passwordLength = toTrimmedString(password).length;
  return passwordLength >= minPasswordLength && passwordLength <= maxPasswordLength;
}

function isPasswordLengthWithinLimit(password) {
  return toTrimmedString(password).length <= maxPasswordLength;
}

function isValidVerificationCode(value) {
  var trimmedValue = toTrimmedString(value);
  return new RegExp('^[0-9]{' + verificationCodeLength + '}$').test(trimmedValue);
}

function shouldRequireEmailVerificationOnLogin() {
  return normalizeBooleanEnv(process.env.REQUIRE_EMAIL_VERIFICATION);
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

function getSignupPrefillCookieOptions(req) {
  return {
    httpOnly: true,
    maxAge: signupPrefillCookieTtlMs,
    path: '/signup',
    sameSite: 'lax',
    secure: Boolean(req && req.secure),
  };
}

function getSignupPrefillFromCookie(req) {
  var rawValue = req && req.cookies ? req.cookies[signupPrefillCookieName] : '';
  var parsedValue = null;
  var normalizedEmail = '';

  if (!rawValue) {
    return {
      email: '',
      name: '',
    };
  }

  try {
    parsedValue = JSON.parse(String(rawValue));
  } catch (error) {
    return {
      email: '',
      name: '',
    };
  }

  normalizedEmail = normalizeEmail(parsedValue && parsedValue.email);
  if (normalizedEmail.length > maxEmailLength) {
    normalizedEmail = '';
  }

  return {
    email: normalizedEmail,
    name: sanitizeText(parsedValue && parsedValue.name, maxUserNameLength),
  };
}

function setSignupPrefillCookie(res, req, email, name) {
  var normalizedEmail = normalizeEmail(email);
  var cleanName = sanitizeText(name, maxUserNameLength);

  if (normalizedEmail.length > maxEmailLength) {
    normalizedEmail = '';
  }

  if (!normalizedEmail && !cleanName) {
    res.clearCookie(signupPrefillCookieName, { path: '/signup' });
    return;
  }

  res.cookie(
    signupPrefillCookieName,
    JSON.stringify({
      email: normalizedEmail,
      name: cleanName,
    }),
    getSignupPrefillCookieOptions(req)
  );
}

function clearSignupPrefillCookie(res) {
  res.clearCookie(signupPrefillCookieName, { path: '/signup' });
}

function getSignupStateCookieOptions(req) {
  return {
    httpOnly: true,
    maxAge: signupPrefillCookieTtlMs,
    path: '/signup',
    sameSite: 'lax',
    secure: Boolean(req && req.secure),
  };
}

function getSignupStateFromCookie(req) {
  var rawValue = req && req.cookies ? req.cookies[signupStateCookieName] : '';
  var parsedValue = null;

  if (!rawValue) {
    return {
      statusCode: '',
      errorCode: '',
    };
  }

  try {
    parsedValue = JSON.parse(String(rawValue));
  } catch (error) {
    return {
      statusCode: '',
      errorCode: '',
    };
  }

  return {
    statusCode: toTrimmedString(parsedValue && parsedValue.statusCode),
    errorCode: toTrimmedString(parsedValue && parsedValue.errorCode),
  };
}

function setSignupStateCookie(res, req, statusCode, errorCode) {
  var cleanStatusCode = toTrimmedString(statusCode);
  var cleanErrorCode = toTrimmedString(errorCode);

  if (!cleanStatusCode && !cleanErrorCode) {
    res.clearCookie(signupStateCookieName, { path: '/signup' });
    return;
  }

  res.cookie(
    signupStateCookieName,
    JSON.stringify({
      statusCode: cleanStatusCode,
      errorCode: cleanErrorCode,
    }),
    getSignupStateCookieOptions(req)
  );
}

function clearSignupStateCookie(res) {
  res.clearCookie(signupStateCookieName, { path: '/signup' });
}

function getScopedCookieOptions(req, path) {
  return {
    httpOnly: true,
    maxAge: signupPrefillCookieTtlMs,
    path: path,
    sameSite: 'lax',
    secure: Boolean(req && req.secure),
  };
}

function getScopedStateFromCookie(req, cookieName) {
  var rawValue = req && req.cookies ? req.cookies[cookieName] : '';
  var parsedValue = null;

  if (!rawValue) {
    return {
      statusCode: '',
      errorCode: '',
    };
  }

  try {
    parsedValue = JSON.parse(String(rawValue));
  } catch (error) {
    return {
      statusCode: '',
      errorCode: '',
    };
  }

  return {
    statusCode: toTrimmedString(parsedValue && parsedValue.statusCode),
    errorCode: toTrimmedString(parsedValue && parsedValue.errorCode),
  };
}

function setScopedStateCookie(res, req, cookieName, path, statusCode, errorCode) {
  var cleanStatusCode = toTrimmedString(statusCode);
  var cleanErrorCode = toTrimmedString(errorCode);

  if (!cleanStatusCode && !cleanErrorCode) {
    res.clearCookie(cookieName, { path: path });
    return;
  }

  res.cookie(
    cookieName,
    JSON.stringify({
      statusCode: cleanStatusCode,
      errorCode: cleanErrorCode,
    }),
    getScopedCookieOptions(req, path)
  );
}

function clearScopedStateCookie(res, cookieName, path) {
  res.clearCookie(cookieName, { path: path });
}

function getScopedEmailFromCookie(req, cookieName) {
  var normalizedEmail = normalizeEmail(req && req.cookies ? req.cookies[cookieName] : '');
  if (normalizedEmail.length > maxEmailLength) {
    return '';
  }
  return normalizedEmail;
}

function setScopedEmailCookie(res, req, cookieName, path, email) {
  var normalizedEmail = normalizeEmail(email);

  if (normalizedEmail.length > maxEmailLength) {
    normalizedEmail = '';
  }

  if (!normalizedEmail) {
    res.clearCookie(cookieName, { path: path });
    return;
  }

  res.cookie(cookieName, normalizedEmail, getScopedCookieOptions(req, path));
}

function clearScopedEmailCookie(res, cookieName, path) {
  res.clearCookie(cookieName, { path: path });
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
    return 0;
  }

  if (!Number.isFinite(parsedValue) || parsedValue < 0) {
    return 0;
  }

  return Math.floor(parsedValue);
}

function buildLoginRedirectPath() {
  return '/login';
}

function redirectToLogin(res, req, statusCode, errorCode, email) {
  setScopedStateCookie(res, req, loginStateCookieName, '/login', statusCode, errorCode);
  setScopedEmailCookie(res, req, loginPrefillCookieName, '/login', email);
  return res.redirect(buildLoginRedirectPath());
}

function buildSignupRedirectPath() {
  return '/signup';
}

function redirectToSignup(res, req, statusCode, errorCode) {
  setSignupStateCookie(res, req, statusCode, errorCode);
  return res.redirect(buildSignupRedirectPath());
}

function buildForgotPasswordRedirectPath() {
  return '/forgot-password';
}

function redirectToForgotPassword(res, req, statusCode, errorCode, email) {
  setScopedStateCookie(res, req, forgotStateCookieName, '/forgot-password', statusCode, errorCode);
  setScopedEmailCookie(res, req, forgotPrefillCookieName, '/forgot-password', email);
  return res.redirect(buildForgotPasswordRedirectPath());
}

function buildProfileRedirectPath() {
  return '/profile';
}

function redirectToProfile(res, req, statusCode, errorCode) {
  setScopedStateCookie(res, req, profileStateCookieName, '/profile', statusCode, errorCode);
  return res.redirect(buildProfileRedirectPath());
}

function buildHomeRedirectPath() {
  return '/';
}

function redirectToHome(res, req, statusCode) {
  setScopedStateCookie(res, req, homeStateCookieName, '/', statusCode, '');
  return res.redirect(buildHomeRedirectPath());
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

async function hashUserPassword(password, salt) {
  var cleanPassword = String(password || '');
  var resolvedSalt = toTrimmedString(salt) || crypto.randomBytes(16).toString('hex');
  var passwordHash = await new Promise(function (resolve, reject) {
    crypto.scrypt(cleanPassword, resolvedSalt, 64, function (error, derivedKey) {
      if (error) {
        reject(error);
        return;
      }

      resolve(Buffer.from(derivedKey).toString('hex'));
    });
  });

  return {
    hash: passwordHash,
    salt: resolvedSalt,
  };
}

async function doesPasswordMatch(password, salt, expectedHash) {
  var cleanSalt = toTrimmedString(salt);
  var cleanExpectedHash = toTrimmedString(expectedHash);

  if (!cleanSalt || !cleanExpectedHash) {
    return false;
  }

  try {
    var generatedPassword = await hashUserPassword(password, cleanSalt);
    var generatedHash = generatedPassword.hash;
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

async function issueAuthCode(email, purpose, name, passwordPayload) {
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
    passwordHash: passwordPayload && passwordPayload.hash ? passwordPayload.hash : '',
    passwordSalt: passwordPayload && passwordPayload.salt ? passwordPayload.salt : '',
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
    return 'Password must be between ' + minPasswordLength + ' and ' + maxPasswordLength + ' characters.';
  }

  if (errorCode === 'password-failed') {
    return 'Email or password is incorrect.';
  }

  if (errorCode === 'invalid-credentials') {
    return 'Email or password is incorrect.';
  }

  if (errorCode === 'db-unavailable') {
    return 'Database is unavailable. Please try again later.';
  }

  if (errorCode === 'no-account') {
    return 'Email or password is incorrect.';
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
    return 'Password must be between ' + minPasswordLength + ' and ' + maxPasswordLength + ' characters.';
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
    return 'Password must be between ' + minPasswordLength + ' and ' + maxPasswordLength + ' characters.';
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
    return 'New password must be between ' + minPasswordLength + ' and ' + maxPasswordLength + ' characters.';
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

function setUserSessionAndRedirectHome(res, req, user, statusCode) {
  userAuth.setUserAuthCookie(res, {
    _id: user._id,
    email: user.email,
    name: user.name,
  });

  return redirectToHome(res, req, statusCode);
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
  var statusCodeFromQuery = toTrimmedString(req.query.status);
  var homeState = null;
  var statusCode = '';
  var q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  var rawCategory = typeof req.query.category === 'string' ? req.query.category.trim() : '';
  var query = q;
  var selectedCategory = catalogService.resolveCategoryName(rawCategory, catalog.categoryGroups);
  var isHomeRoute = req.path === '/home' || req.path === '/home/';
  var isRootRoute = req.path === '/';
  var hasActiveFilters = q.length > 0 || Boolean(selectedCategory);
  var showCarousel = isRootRoute && !hasActiveFilters;
  var basePath = isHomeRoute ? '/home' : '/';
  var redirectParams = [];
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

  if (statusCodeFromQuery) {
    setScopedStateCookie(res, req, homeStateCookieName, '/', statusCodeFromQuery, '');

    if (q) {
      redirectParams.push('q=' + encodeURIComponent(q));
    }

    if (selectedCategory) {
      redirectParams.push('category=' + encodeURIComponent(selectedCategory));
    }

    if (currentPage > 1) {
      redirectParams.push('page=' + encodeURIComponent(String(currentPage)));
    }

    return res.redirect(basePath + (redirectParams.length ? ('?' + redirectParams.join('&')) : ''));
  }

  homeState = getScopedStateFromCookie(req, homeStateCookieName);
  statusCode = homeState.statusCode;

  if (statusCode) {
    clearScopedStateCookie(res, homeStateCookieName, '/');
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
    return redirectToLogin(res, req, '', 'login-required', '');
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
  var statusCodeFromQuery = toTrimmedString(req.query.status);
  var errorCodeFromQuery = toTrimmedString(req.query.error);
  var emailFromQuery = normalizeEmail(req.query.email);
  var hasLegacyStateQuery = Boolean(statusCodeFromQuery || errorCodeFromQuery);
  var hasLegacyPrefillQuery = Boolean(emailFromQuery);
  var loginState = null;
  var statusCode = '';
  var errorCode = '';
  var email = '';
  var categoryGroupsForView = catalogService.buildCategoryViewData('', '', catalog.categoryGroups);
  var openCategoryName = catalogService.getOpenCategoryName(categoryGroupsForView, '', '');

  if (req.userAuth) {
    return res.redirect('/');
  }

  loginState = getScopedStateFromCookie(req, loginStateCookieName);

  if (hasLegacyStateQuery || hasLegacyPrefillQuery) {
    if (hasLegacyStateQuery) {
      setScopedStateCookie(res, req, loginStateCookieName, '/login', statusCodeFromQuery, errorCodeFromQuery);
    }

    if (hasLegacyPrefillQuery) {
      setScopedEmailCookie(res, req, loginPrefillCookieName, '/login', emailFromQuery);
    }

    return res.redirect(buildLoginRedirectPath());
  }

  statusCode = loginState.statusCode;
  errorCode = loginState.errorCode;
  email = getScopedEmailFromCookie(req, loginPrefillCookieName);

  if (statusCode || errorCode) {
    clearScopedStateCookie(res, loginStateCookieName, '/login');
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
    minPasswordLength: minPasswordLength,
    maxPasswordLength: maxPasswordLength,
    maxEmailLength: maxEmailLength,
    statusMessage: getLoginStatusMessage(statusCode),
    errorMessage: getLoginErrorMessage(errorCode),
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
}

function renderLoginPageWithMessage(req, res, statusCode, errorCode, email) {
  var catalog = catalogService.getCatalogContext();
  var categoryGroupsForView = catalogService.buildCategoryViewData('', '', catalog.categoryGroups);
  var openCategoryName = catalogService.getOpenCategoryName(categoryGroupsForView, '', '');

  return res.status(errorCode ? 400 : 200).render('login', {
    title: 'Login | BhutanDevi Trade and Suppliers',
    q: '',
    activeCategory: '',
    currentPath: '/login',
    currentUser: null,
    showUserAuthActions: true,
    hasQuery: false,
    openCategoryName: openCategoryName,
    categoryGroups: categoryGroupsForView,
    authEmail: normalizeEmail(email),
    minPasswordLength: minPasswordLength,
    maxPasswordLength: maxPasswordLength,
    maxEmailLength: maxEmailLength,
    statusMessage: getLoginStatusMessage(statusCode),
    errorMessage: getLoginErrorMessage(errorCode),
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
}

function renderSignupPage(req, res) {
  var catalog = catalogService.getCatalogContext();
  var statusCodeFromQuery = toTrimmedString(req.query.status);
  var errorCodeFromQuery = toTrimmedString(req.query.error);
  var emailFromQuery = normalizeEmail(req.query.email);
  var nameFromQuery = sanitizeText(req.query.name, maxUserNameLength);
  var hasLegacyStatusQuery = Boolean(statusCodeFromQuery || errorCodeFromQuery);
  var hasLegacyPrefillQuery = Boolean(emailFromQuery || nameFromQuery);
  var signupPrefill = null;
  var signupState = null;
  var statusCode = '';
  var errorCode = '';
  var email = '';
  var name = '';
  var requireCode = statusCode === 'code-sent' && Boolean(email);
  var categoryGroupsForView = catalogService.buildCategoryViewData('', '', catalog.categoryGroups);
  var openCategoryName = catalogService.getOpenCategoryName(categoryGroupsForView, '', '');

  if (req.userAuth) {
    return res.redirect('/');
  }

  signupPrefill = getSignupPrefillFromCookie(req);
  signupState = getSignupStateFromCookie(req);

  if (hasLegacyPrefillQuery || hasLegacyStatusQuery) {
    if (hasLegacyPrefillQuery) {
      setSignupPrefillCookie(
        res,
        req,
        emailFromQuery || signupPrefill.email,
        nameFromQuery || signupPrefill.name
      );
    }

    if (hasLegacyStatusQuery) {
      setSignupStateCookie(res, req, statusCodeFromQuery, errorCodeFromQuery);
    }

    return res.redirect(buildSignupRedirectPath());
  }

  email = signupPrefill.email;
  name = signupPrefill.name;
  statusCode = signupState.statusCode;
  errorCode = signupState.errorCode;

  if (!email && statusCode === 'code-sent') {
    statusCode = '';
    setSignupStateCookie(res, req, statusCode, errorCode);
  }

  requireCode = statusCode === 'code-sent' && Boolean(email);

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
    minUserNameLength: minUserNameLength,
    maxUserNameLength: maxUserNameLength,
    minPasswordLength: minPasswordLength,
    maxPasswordLength: maxPasswordLength,
    maxEmailLength: maxEmailLength,
    verificationCodeLength: verificationCodeLength,
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
  var statusCodeFromQuery = toTrimmedString(req.query.status);
  var errorCodeFromQuery = toTrimmedString(req.query.error);
  var emailFromQuery = normalizeEmail(req.query.email);
  var hasLegacyStateQuery = Boolean(statusCodeFromQuery || errorCodeFromQuery);
  var hasLegacyPrefillQuery = Boolean(emailFromQuery);
  var forgotState = null;
  var statusCode = '';
  var errorCode = '';
  var email = '';
  var authenticatedUser = req.userAuth && req.userAuth.email ? req.userAuth : null;
  var requireCode = false;
  var categoryGroupsForView = catalogService.buildCategoryViewData('', '', catalog.categoryGroups);
  var openCategoryName = catalogService.getOpenCategoryName(categoryGroupsForView, '', '');
  var effectiveEmail = '';

  forgotState = getScopedStateFromCookie(req, forgotStateCookieName);

  if (hasLegacyStateQuery || hasLegacyPrefillQuery) {
    if (hasLegacyStateQuery) {
      setScopedStateCookie(res, req, forgotStateCookieName, '/forgot-password', statusCodeFromQuery, errorCodeFromQuery);
    }

    if (hasLegacyPrefillQuery) {
      setScopedEmailCookie(res, req, forgotPrefillCookieName, '/forgot-password', emailFromQuery);
    }

    return res.redirect(buildForgotPasswordRedirectPath());
  }

  statusCode = forgotState.statusCode;
  errorCode = forgotState.errorCode;
  email = getScopedEmailFromCookie(req, forgotPrefillCookieName);
  effectiveEmail = email || normalizeEmail(authenticatedUser ? authenticatedUser.email : '');
  requireCode = statusCode === 'code-sent' && Boolean(effectiveEmail);

  if (!effectiveEmail && statusCode === 'code-sent') {
    statusCode = '';
    setScopedStateCookie(res, req, forgotStateCookieName, '/forgot-password', statusCode, errorCode);
    requireCode = false;
  }

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
    minPasswordLength: minPasswordLength,
    maxPasswordLength: maxPasswordLength,
    maxEmailLength: maxEmailLength,
    verificationCodeLength: verificationCodeLength,
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
    return redirectToLogin(res, req, '', 'login-required', '');
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
  var statusCodeFromQuery = toTrimmedString(req.query.status);
  var errorCodeFromQuery = toTrimmedString(req.query.error);
  var hasLegacyStateQuery = Boolean(statusCodeFromQuery || errorCodeFromQuery);
  var profileState = null;
  var statusCode = '';
  var errorCode = '';
  var categoryGroupsForView = catalogService.buildCategoryViewData('', '', catalog.categoryGroups);
  var openCategoryName = catalogService.getOpenCategoryName(categoryGroupsForView, '', '');
  var statusMessage = '';
  var errorMessage = '';
  var userRecord = null;
  var profileName = sanitizeText(authenticatedUser ? authenticatedUser.name : '', maxUserNameLength);
  var profileEmail = normalizeEmail(authenticatedUser ? authenticatedUser.email : '');
  var hasConnectedDb = false;

  if (!authenticatedUser) {
    return redirectToLogin(res, req, '', 'login-required', '');
  }

  if (hasLegacyStateQuery) {
    setScopedStateCookie(res, req, profileStateCookieName, '/profile', statusCodeFromQuery, errorCodeFromQuery);
    return res.redirect(buildProfileRedirectPath());
  }

  profileState = getScopedStateFromCookie(req, profileStateCookieName);
  statusCode = profileState.statusCode;
  errorCode = profileState.errorCode;
  statusMessage = getProfileStatusMessage(statusCode);
  errorMessage = getProfileErrorMessage(errorCode);

  if (statusCode || errorCode) {
    clearScopedStateCookie(res, profileStateCookieName, '/profile');
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
    minUserNameLength: minUserNameLength,
    maxUserNameLength: maxUserNameLength,
    minPasswordLength: minPasswordLength,
    maxPasswordLength: maxPasswordLength,
    topNavCategories: catalog.categoryGroups,
    searchSuggestions: catalogService.buildSearchSuggestions(catalog.categoryGroups, catalog.productSections),
    basePath: '/',
  });
}

async function handleProfileNameUpdate(req, res) {
  var authenticatedUser = req.userAuth && req.userAuth.email ? req.userAuth : null;
  var rawName = toTrimmedString(req.body.name);
  var name = sanitizeText(rawName, maxUserNameLength);
  var userRecord = null;

  if (!authenticatedUser) {
    return redirectToLogin(res, req, '', 'login-required', '');
  }

  if (!name || rawName.length < minUserNameLength || rawName.length > maxUserNameLength) {
    return redirectToProfile(res, req, '', 'invalid-name');
  }

  try {
    if (!await ensureDatabaseConnection()) {
      return redirectToProfile(res, req, '', 'db-unavailable');
    }

    userRecord = await findAuthenticatedUserRecord(authenticatedUser);

    if (!userRecord) {
      return redirectToProfile(res, req, '', 'user-not-found');
    }

    userRecord.name = name;
    await userRecord.save();
    userAuth.setUserAuthCookie(res, {
      _id: userRecord._id,
      email: userRecord.email,
      name: userRecord.name,
    });

    return redirectToProfile(res, req, 'name-updated', '');
  } catch (error) {
    console.error('Profile name update failed:', error.message);
    return redirectToProfile(res, req, '', 'save-failed');
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
    return redirectToLogin(res, req, '', 'login-required', '');
  }

  if (!currentPassword) {
    return redirectToProfile(res, req, '', 'invalid-current-password');
  }

  if (!isPasswordLengthWithinLimit(currentPassword)) {
    return redirectToProfile(res, req, '', 'invalid-current-password');
  }

  if (!isPasswordLengthValid(newPassword)) {
    return redirectToProfile(res, req, '', 'invalid-new-password');
  }

  if (!isPasswordLengthWithinLimit(confirmPassword)) {
    return redirectToProfile(res, req, '', 'password-mismatch');
  }

  if (newPassword !== confirmPassword) {
    return redirectToProfile(res, req, '', 'password-mismatch');
  }

  try {
    if (!await ensureDatabaseConnection()) {
      return redirectToProfile(res, req, '', 'db-unavailable');
    }

    userRecord = await findAuthenticatedUserRecord(authenticatedUser);

    if (!userRecord) {
      return redirectToProfile(res, req, '', 'user-not-found');
    }

    if (!await doesPasswordMatch(currentPassword, userRecord.passwordSalt, userRecord.passwordHash)) {
      return redirectToProfile(res, req, '', 'invalid-current-password');
    }

    if (await doesPasswordMatch(newPassword, userRecord.passwordSalt, userRecord.passwordHash)) {
      return redirectToProfile(res, req, '', 'same-password');
    }

    passwordPayload = await hashUserPassword(newPassword);
    userRecord.passwordHash = passwordPayload.hash;
    userRecord.passwordSalt = passwordPayload.salt;
    userRecord.authProvider = 'email-password';
    await userRecord.save();
    userAuth.setUserAuthCookie(res, {
      _id: userRecord._id,
      email: userRecord.email,
      name: userRecord.name,
    });

    return redirectToProfile(res, req, 'password-updated', '');
  } catch (error) {
    console.error('Profile password update failed:', error.message);
    return redirectToProfile(res, req, '', 'save-failed');
  }
}

async function handleLoginSubmit(req, res) {
  var email = normalizeEmail(req.body.email);
  var password = toTrimmedString(req.body.password);
  var user = null;
  var code = '';
  var sendResult = null;
  var requireEmailVerificationOnLogin = shouldRequireEmailVerificationOnLogin();

  if (!email || email.length > maxEmailLength || !isValidEmailAddress(email)) {
    return renderLoginPageWithMessage(req, res, '', 'invalid-email', email);
  }

  if (!isPasswordLengthValid(password)) {
    return renderLoginPageWithMessage(req, res, '', 'invalid-password', email);
  }

  if (!await ensureDatabaseConnection()) {
    return renderLoginPageWithMessage(req, res, '', 'db-unavailable', email);
  }

  user = await User.findOne({ email: email });

  if (!user) {
    return renderLoginPageWithMessage(req, res, '', 'invalid-credentials', email);
  }

  if (!await doesPasswordMatch(password, user.passwordSalt, user.passwordHash)) {
    return renderLoginPageWithMessage(req, res, '', 'invalid-credentials', email);
  }

  if (!user.isEmailVerified && requireEmailVerificationOnLogin) {
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
        return renderLoginPageWithMessage(req, res, '', 'email-send-failed', email);
      }

      setSignupPrefillCookie(res, req, email, user.name);
      return redirectToSignup(res, req, 'code-sent', '');
    } catch (error) {
      console.error('Login verification email issue failed:', error.message);
      return renderLoginPageWithMessage(req, res, '', 'save-failed', email);
    }
  }

  if (!user.isEmailVerified && !requireEmailVerificationOnLogin) {
    user.isEmailVerified = true;
  }

  try {
    user.lastLoginAt = new Date();
    await user.save();
    clearScopedStateCookie(res, loginStateCookieName, '/login');
    clearScopedEmailCookie(res, loginPrefillCookieName, '/login');
    return setUserSessionAndRedirectHome(res, req, user, 'login-success');
  } catch (error) {
    console.error('Login save failed:', error.message);
    return renderLoginPageWithMessage(req, res, '', 'save-failed', email);
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
  var newUser = null;

  setSignupPrefillCookie(res, req, email, name);

  if (!name || name.length < minUserNameLength || name.length > maxUserNameLength) {
    return redirectToSignup(res, req, '', 'invalid-name');
  }

  if (!email || email.length > maxEmailLength || !isValidEmailAddress(email)) {
    return redirectToSignup(res, req, '', 'invalid-email');
  }

  if (!await ensureDatabaseConnection()) {
    return redirectToSignup(res, req, '', 'db-unavailable');
  }

  existingUser = await User.findOne({ email: email });

  if (existingUser && existingUser.isEmailVerified) {
    return redirectToSignup(res, req, '', 'email-exists');
  }

  if (!verificationCode) {
    try {
      if (!isPasswordLengthValid(password)) {
        return redirectToSignup(res, req, '', 'invalid-password');
      }

      passwordPayload = await hashUserPassword(password);
      code = await issueAuthCode(email, 'signup', name, passwordPayload);
      sendResult = await resendService.sendEmail({
        to: email,
        subject: buildOtpEmailSubject('signup', code),
        html: buildOtpEmailHtml('signup', code),
        text: buildOtpEmailText('signup', code),
      });

      if (!sendResult.ok) {
        console.error('Resend signup email failed:', sendResult.errorCode || 'unknown');
        return redirectToSignup(res, req, '', 'email-send-failed');
      }

      return redirectToSignup(res, req, 'code-sent', '');
    } catch (error) {
      console.error('Signup code issue failed:', error.message);
      return redirectToSignup(res, req, '', 'save-failed');
    }
  }

  if (!isValidVerificationCode(verificationCode)) {
    return redirectToSignup(res, req, 'code-sent', 'invalid-code');
  }

  // A verification code was provided.
  try {
    verificationResult = await verifyAuthCode(email, 'signup', verificationCode);

    if (!verificationResult.ok) {
      return redirectToSignup(res, req, 'code-sent', verificationResult.errorCode);
    }

    var authRecord = verificationResult.record;
    if (!authRecord || !authRecord.passwordHash) {
      return redirectToSignup(res, req, '', 'save-failed');
    }

    if (existingUser) {
      // This case is unlikely if the initial check passed, but handle it.
      // An unverified user record exists, so we'll verify it now.
      existingUser.name = authRecord.name || name;
      existingUser.passwordHash = authRecord.passwordHash;
      existingUser.passwordSalt = authRecord.passwordSalt;
      existingUser.isEmailVerified = true;
      existingUser.lastLoginAt = new Date();
      await existingUser.save();
      newUser = existingUser;
    } else {
      // Create the new user *after* OTP verification.
      newUser = await User.create({
        email: email,
        name: authRecord.name || name,
        authProvider: 'email-password',
        passwordHash: authRecord.passwordHash,
        passwordSalt: authRecord.passwordSalt,
        isEmailVerified: true,
        lastLoginAt: new Date(),
      });
    }

    clearSignupPrefillCookie(res);
    clearSignupStateCookie(res);
    return setUserSessionAndRedirectHome(res, req, newUser);
  } catch (error) {
    console.error('Signup verification failed:', error.message);
    if (isDuplicateKeyError(error)) {
      return redirectToSignup(res, req, '', 'email-exists');
    }
    return redirectToSignup(res, req, '', 'save-failed');
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

  setScopedEmailCookie(res, req, forgotPrefillCookieName, '/forgot-password', email);

  if (!email || email.length > maxEmailLength || !isValidEmailAddress(email)) {
    return redirectToForgotPassword(res, req, '', 'invalid-email', email);
  }

  if (!await ensureDatabaseConnection()) {
    return redirectToForgotPassword(res, req, '', 'db-unavailable', email);
  }

  if (!verificationCode) {
    existingUser = await User.findOne({ email: email });

    if (!existingUser) {
      return redirectToForgotPassword(res, req, '', 'no-account', email);
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
        return redirectToForgotPassword(res, req, '', 'email-send-failed', email);
      }

      return redirectToForgotPassword(res, req, 'code-sent', '', email);
    } catch (error) {
      console.error('Forgot password code issue failed:', error.message);
      return redirectToForgotPassword(res, req, '', 'save-failed', email);
    }
  }

  if (!isValidVerificationCode(verificationCode)) {
    return redirectToForgotPassword(res, req, 'code-sent', 'invalid-code', email);
  }

  if (!isPasswordLengthValid(password)) {
    return redirectToForgotPassword(res, req, 'code-sent', 'invalid-password', email);
  }

  try {
    verificationResult = await verifyAuthCode(email, 'password-reset', verificationCode);

    if (!verificationResult.ok) {
      return redirectToForgotPassword(res, req, 'code-sent', verificationResult.errorCode, email);
    }

    existingUser = await User.findOne({ email: email });

    if (!existingUser) {
      return redirectToForgotPassword(res, req, '', 'no-account', email);
    }

    passwordPayload = await hashUserPassword(password);
    existingUser.passwordHash = passwordPayload.hash;
    existingUser.passwordSalt = passwordPayload.salt;
    existingUser.authProvider = 'email-password';
    await existingUser.save();

    clearScopedEmailCookie(res, forgotPrefillCookieName, '/forgot-password');
    clearScopedStateCookie(res, forgotStateCookieName, '/forgot-password');
    return redirectToLogin(res, req, 'password-reset-success', '', email);
  } catch (error) {
    console.error('Forgot password verification failed:', error.message);
    return redirectToForgotPassword(res, req, '', 'save-failed', email);
  }
}

function queueOrderNotificationEmails(orderRecord, orderData, options) {
  var notificationEmail = normalizeEmail(options && options.notificationEmail);
  var emailSubject = sanitizeText(options && options.emailSubject, 220);
  var customerEmail = normalizeEmail(options && options.customerEmail);
  var shouldSendCustomerConfirmation = Boolean(options && options.shouldSendCustomerConfirmation);
  var productName = sanitizeText(options && options.productName, 180);
  var quantity = parsePositiveInteger(options && options.quantity, 1);
  var totalLabel = sanitizeText(options && options.totalLabel, 120);

  if (!orderRecord || typeof orderRecord.save !== 'function') {
    return;
  }

  Promise.resolve().then(async function () {
    var notificationResult = null;
    var confirmationResult = null;

    if (!notificationEmail || !isValidEmailAddress(notificationEmail) || !emailSubject) {
      console.error('Order email skipped: ORDER_NOTIFICATION_EMAIL is not configured.');
      orderRecord.status = 'email-failed';
      orderRecord.emailNotificationSent = false;
      orderRecord.customerConfirmationSent = false;
      await orderRecord.save();
      return;
    }

    notificationResult = await resendService.sendEmail({
      to: notificationEmail,
      subject: emailSubject,
      text: buildOrderNotificationText(orderData),
      html: buildOrderNotificationHtml(orderData),
    });

    if (!notificationResult.ok) {
      console.error('Order email send failed:', notificationResult.errorCode || 'unknown');
      orderRecord.status = 'email-failed';
      orderRecord.emailNotificationSent = false;
      orderRecord.customerConfirmationSent = false;
      await orderRecord.save();
      return;
    }

    orderRecord.status = 'submitted';
    orderRecord.emailNotificationSent = true;
    orderRecord.customerConfirmationSent = false;
    await orderRecord.save();

    if (!shouldSendCustomerConfirmation || !customerEmail || !isLikelyEmailAddress(customerEmail)) {
      return;
    }

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
      return;
    }

    orderRecord.customerConfirmationSent = true;
    await orderRecord.save();
  }).catch(async function (error) {
    console.error('Order notification queue failed:', error && error.message ? error.message : 'unknown');

    try {
      orderRecord.status = 'email-failed';
      orderRecord.emailNotificationSent = false;
      orderRecord.customerConfirmationSent = false;
      await orderRecord.save();
    } catch (orderSaveError) {
      console.error('Order failure status update failed:', orderSaveError.message);
    }
  });
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
  var shouldSendCustomerConfirmation = false;

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

  if (!customerEmail || !isValidEmailAddress(customerEmail)) {
    return res.status(401).json({
      ok: false,
      errorCode: 'invalid-auth-session',
      message: 'Please login again to place an order.',
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

  shouldSendCustomerConfirmation = customerEmail && isLikelyEmailAddress(customerEmail);

  queueOrderNotificationEmails(orderRecord, orderData, {
    notificationEmail: notificationEmail,
    emailSubject: emailSubject,
    customerEmail: customerEmail,
    shouldSendCustomerConfirmation: shouldSendCustomerConfirmation,
    productName: productName,
    quantity: quantity,
    totalLabel: totalLabel,
  });

  return res.json({
    ok: true,
    message: 'Order received successfully.',
    orderId: orderRecord && orderRecord._id ? String(orderRecord._id) : '',
    whatsappMessage: buildOrderWhatsappMessage(orderData),
  });
}

async function handleUserLogout(req, res) {
  userAuth.clearUserAuthCookie(res);
  return redirectToLogin(res, req, 'logged-out', '', '');
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
