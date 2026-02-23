var crypto = require('crypto');

var adminCookieName = 'bd_admin_session';
var adminCookieMaxAgeMs = 1000 * 60 * 60 * 12; // 12 hours
var fallbackSessionSecret = crypto.randomBytes(32).toString('hex');

function normalizeBooleanEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function toTrimmedString(value) {
  return String(value || '').trim();
}

function getAuthConfig() {
  var username = toTrimmedString(process.env.ADMIN_USERNAME) || 'sugam';
  var password = toTrimmedString(process.env.ADMIN_PASSWORD) || 'sugaM@098';
  var authDisabled = normalizeBooleanEnv(process.env.ADMIN_AUTH_DISABLED);

  return {
    enabled: !authDisabled,
    username: username,
    password: password,
    secret: toTrimmedString(process.env.ADMIN_SESSION_SECRET) || fallbackSessionSecret,
  };
}

function timingSafeEqual(left, right) {
  var leftBuffer = Buffer.from(String(left || ''), 'utf8');
  var rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signTokenPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function buildSessionToken(username, secret) {
  var issuedAt = Date.now().toString(36);
  var payload = username + '.' + issuedAt;
  var signature = signTokenPayload(payload, secret);
  return payload + '.' + signature;
}

function parseAndVerifyToken(token, secret) {
  var rawToken = toTrimmedString(token);
  var tokenParts = rawToken.split('.');

  if (tokenParts.length !== 3) {
    return null;
  }

  var username = tokenParts[0];
  var issuedAt = tokenParts[1];
  var signature = tokenParts[2];
  var payload = username + '.' + issuedAt;
  var expectedSignature = signTokenPayload(payload, secret);

  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  return {
    username: username,
  };
}

function validateCredentials(inputUsername, inputPassword) {
  var config = getAuthConfig();

  if (!config.enabled) {
    return true;
  }

  return timingSafeEqual(toTrimmedString(inputUsername), config.username) && timingSafeEqual(String(inputPassword || ''), config.password);
}

function isAuthenticatedRequest(req) {
  var config = getAuthConfig();

  if (!config.enabled) {
    return true;
  }

  var cookieValue = req && req.cookies ? req.cookies[adminCookieName] : '';
  var session = parseAndVerifyToken(cookieValue, config.secret);

  return Boolean(session && timingSafeEqual(session.username, config.username));
}

function setAuthCookie(res, username) {
  var config = getAuthConfig();
  var token = buildSessionToken(username, config.secret);
  var isProduction = process.env.NODE_ENV === 'production';

  res.cookie(adminCookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: adminCookieMaxAgeMs,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(adminCookieName, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
  });
}

function getSafeAdminNextPath(value) {
  var nextPath = toTrimmedString(value) || '/admin';

  if (nextPath.charAt(0) !== '/') {
    return '/admin';
  }

  if (nextPath.indexOf('/admin') !== 0) {
    return '/admin';
  }

  return nextPath;
}

function buildLoginRedirect(req) {
  var nextPath = getSafeAdminNextPath(req && req.originalUrl);
  return '/admin/login?next=' + encodeURIComponent(nextPath);
}

function requireAdminAuth(req, res, next) {
  if (isAuthenticatedRequest(req)) {
    return next();
  }

  if (req.method !== 'GET') {
    return res.status(401).redirect(buildLoginRedirect(req));
  }

  return res.redirect(buildLoginRedirect(req));
}

module.exports = {
  adminCookieName: adminCookieName,
  clearAuthCookie: clearAuthCookie,
  getAuthConfig: getAuthConfig,
  getSafeAdminNextPath: getSafeAdminNextPath,
  isAuthenticatedRequest: isAuthenticatedRequest,
  requireAdminAuth: requireAdminAuth,
  setAuthCookie: setAuthCookie,
  validateCredentials: validateCredentials,
};
