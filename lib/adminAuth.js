var crypto = require('crypto');

var adminCookieName = 'bd_admin_session';
var adminCookieMaxAgeMs = 1000 * 60 * 60 * 12; // 12 hours
var adminLoginStateCookieName = 'bd_admin_login_state';
var adminLoginStateCookieMaxAgeMs = 1000 * 60 * 30; // 30 minutes
var fallbackSessionSecret = crypto.randomBytes(32).toString('hex');
var tokenClockSkewMs = 1000 * 60 * 5; // 5 minutes
var hasWarnedAuthMisconfiguration = false;

function normalizeBooleanEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function toTrimmedString(value) {
  return String(value || '').trim();
}

function getAuthConfig() {
  var isProduction = process.env.NODE_ENV === 'production';
  var username = toTrimmedString(process.env.ADMIN_USERNAME);
  var password = toTrimmedString(process.env.ADMIN_PASSWORD);
  var authDisabled = normalizeBooleanEnv(process.env.ADMIN_AUTH_DISABLED);
  var configured = false;

  if (!isProduction) {
    username = username || 'sugam';
    password = password || 'sugaM@098';
  }

  configured = Boolean(username && password);

  if (!hasWarnedAuthMisconfiguration && !authDisabled && !configured) {
    console.error('Admin auth is enabled but ADMIN_USERNAME/ADMIN_PASSWORD are missing. Configure both values to allow admin login.');
    hasWarnedAuthMisconfiguration = true;
  }

  return {
    enabled: !authDisabled,
    configured: configured,
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
  var issuedAtMs = 0;
  var now = Date.now();

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

  issuedAtMs = parseInt(issuedAt, 36);
  if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0) {
    return null;
  }

  if (issuedAtMs > now + tokenClockSkewMs) {
    return null;
  }

  if ((now - issuedAtMs) > adminCookieMaxAgeMs) {
    return null;
  }

  return {
    username: username,
    issuedAt: issuedAtMs,
  };
}

function validateCredentials(inputUsername, inputPassword) {
  var config = getAuthConfig();

  if (!config.enabled) {
    return true;
  }

  if (!config.configured) {
    return false;
  }

  return timingSafeEqual(toTrimmedString(inputUsername), config.username) && timingSafeEqual(String(inputPassword || ''), config.password);
}

function isAuthenticatedRequest(req) {
  var config = getAuthConfig();

  if (!config.enabled) {
    return true;
  }

  if (!config.configured) {
    return false;
  }

  var cookieValue = req && req.cookies ? req.cookies[adminCookieName] : '';
  var session = parseAndVerifyToken(cookieValue, config.secret);

  return Boolean(session && timingSafeEqual(session.username, config.username));
}

function setAuthCookie(res, username) {
  var config = getAuthConfig();
  var token = buildSessionToken(username, config.secret);
  var isProduction = process.env.NODE_ENV === 'production';

  if (!config.enabled || !config.configured || !token) {
    return;
  }

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

function getLoginStateCookieOptions(req) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(req && req.secure),
    maxAge: adminLoginStateCookieMaxAgeMs,
    path: '/admin/login',
  };
}

function getLoginState(req) {
  var rawState = req && req.cookies ? req.cookies[adminLoginStateCookieName] : '';
  var parsedState = null;

  if (!rawState) {
    return {
      statusCode: '',
      errorCode: '',
      nextPath: '',
    };
  }

  try {
    parsedState = JSON.parse(String(rawState));
  } catch (error) {
    return {
      statusCode: '',
      errorCode: '',
      nextPath: '',
    };
  }

  return {
    statusCode: toTrimmedString(parsedState && parsedState.statusCode),
    errorCode: toTrimmedString(parsedState && parsedState.errorCode),
    nextPath: getSafeAdminNextPath(parsedState && parsedState.nextPath),
  };
}

function setLoginState(res, req, statusCode, errorCode, nextPath) {
  var cleanStatusCode = toTrimmedString(statusCode);
  var cleanErrorCode = toTrimmedString(errorCode);
  var cleanNextPath = getSafeAdminNextPath(nextPath);

  if (!cleanStatusCode && !cleanErrorCode && cleanNextPath === '/admin') {
    res.clearCookie(adminLoginStateCookieName, { path: '/admin/login' });
    return;
  }

  res.cookie(
    adminLoginStateCookieName,
    JSON.stringify({
      statusCode: cleanStatusCode,
      errorCode: cleanErrorCode,
      nextPath: cleanNextPath,
    }),
    getLoginStateCookieOptions(req)
  );
}

function clearLoginState(res) {
  res.clearCookie(adminLoginStateCookieName, { path: '/admin/login' });
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

function buildLoginRedirect(req, res) {
  var nextPath = getSafeAdminNextPath(req && req.originalUrl);
  setLoginState(res, req, '', '', nextPath);
  return '/admin/login';
}

function requireAdminAuth(req, res, next) {
  if (isAuthenticatedRequest(req)) {
    return next();
  }

  if (req.method !== 'GET') {
    return res.status(401).redirect(buildLoginRedirect(req, res));
  }

  return res.redirect(buildLoginRedirect(req, res));
}

module.exports = {
  adminCookieName: adminCookieName,
  clearAuthCookie: clearAuthCookie,
  clearLoginState: clearLoginState,
  getAuthConfig: getAuthConfig,
  getLoginState: getLoginState,
  getSafeAdminNextPath: getSafeAdminNextPath,
  isAuthenticatedRequest: isAuthenticatedRequest,
  requireAdminAuth: requireAdminAuth,
  setLoginState: setLoginState,
  setAuthCookie: setAuthCookie,
  validateCredentials: validateCredentials,
};
