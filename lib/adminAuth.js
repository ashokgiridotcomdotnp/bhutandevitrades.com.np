import crypto from 'crypto';
import config from './config.js';
import logger from './logger.js';


let adminCookieName = 'bd_admin_session';
let adminCookieMaxAgeMs = 1000 * 60 * 60 * 12; // 12 hours
let adminLoginStateCookieName = 'bd_admin_login_state';
let adminLoginStateCookieMaxAgeMs = 1000 * 60 * 30; // 30 minutes
let fallbackSessionSecret = crypto.randomBytes(32).toString('hex');
let tokenClockSkewMs = 1000 * 60 * 5; // 5 minutes
let hasWarnedAuthMisconfiguration = false;

function normalizeBooleanEnv(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

function toTrimmedString(value) {
  return String(value || '').trim();
}

function getAuthConfig() {
  let username = toTrimmedString(config.auth.adminUsername);
  let password = toTrimmedString(config.auth.adminPassword);
  let authDisabled = Boolean(config.auth.adminAuthDisabled);
  let configured = false;

  configured = Boolean(username && password);

  if (!hasWarnedAuthMisconfiguration && !authDisabled && !configured) {
    logger.warn('Admin auth is enabled but ADMIN_USERNAME or ADMIN_PASSWORD is missing.');
    hasWarnedAuthMisconfiguration = true;
  }

  return {
    enabled: !authDisabled,
    configured: configured,
    username: username,
    password: password,
    secret: toTrimmedString(config.auth.adminSessionSecret) || fallbackSessionSecret,
  };
}

function timingSafeEqual(left, right) {
  let leftBuffer = Buffer.from(String(left || ''), 'utf8');
  let rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function signTokenPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function buildSessionToken(username, secret) {
  let issuedAt = Date.now().toString(36);
  let payload = username + '.' + issuedAt;
  let signature = signTokenPayload(payload, secret);
  return payload + '.' + signature;
}

function parseAndVerifyToken(token, secret) {
  let rawToken = toTrimmedString(token);
  let tokenParts = rawToken.split('.');
  let issuedAtMs = 0;
  let now = Date.now();

  if (tokenParts.length !== 3) {
    return null;
  }

  let username = tokenParts[0];
  let issuedAt = tokenParts[1];
  let signature = tokenParts[2];
  let payload = username + '.' + issuedAt;
  let expectedSignature = signTokenPayload(payload, secret);

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
  let config = getAuthConfig();

  if (!config.enabled) {
    return true;
  }

  if (!config.configured) {
    return false;
  }

  return timingSafeEqual(toTrimmedString(inputUsername), config.username) && timingSafeEqual(String(inputPassword || ''), config.password);
}

function isAuthenticatedRequest(req) {
  let config = getAuthConfig();

  if (!config.enabled) {
    return true;
  }

  if (!config.configured) {
    return false;
  }

  let cookieValue = req && req.cookies ? req.cookies[adminCookieName] : '';
  let session = parseAndVerifyToken(cookieValue, config.secret);

  return Boolean(session && timingSafeEqual(session.username, config.username));
}

function setAuthCookie(res, username) {
  let config = getAuthConfig();
  let token = buildSessionToken(username, config.secret);
  let isProduction = config.app.isProduction;

  if (!config.enabled || !config.configured || !token) {
    return;
  }

  res.cookie(adminCookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    maxAge: adminCookieMaxAgeMs,
    path: '/',
  });
}

function clearAuthCookie(res) {
  res.clearCookie(adminCookieName, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
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
  let rawState = req && req.cookies ? req.cookies[adminLoginStateCookieName] : '';
  let parsedState = null;

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
  let cleanStatusCode = toTrimmedString(statusCode);
  let cleanErrorCode = toTrimmedString(errorCode);
  let cleanNextPath = getSafeAdminNextPath(nextPath);

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
  let nextPath = toTrimmedString(value) || '/admin';

  if (nextPath.charAt(0) !== '/') {
    return '/admin';
  }

  if (nextPath.indexOf('/admin') !== 0) {
    return '/admin';
  }

  return nextPath;
}

function buildLoginRedirect(req, res) {
  let nextPath = getSafeAdminNextPath(req && req.originalUrl);
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
export default {
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
