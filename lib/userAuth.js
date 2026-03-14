import crypto from 'crypto';
import config from './config.js';


let userCookieName = 'bd_user_session';
let userCookieMaxAgeMs = 1000 * 60 * 60 * 24 * 30; // 30 days
let loginStateCookieName = 'bd_login_state';
let fallbackSessionSecret = crypto.randomBytes(32).toString('hex');
let tokenClockSkewMs = 1000 * 60 * 5; // 5 minutes

function toTrimmedString(value) {
  return String(value || '').trim();
}

function timingSafeEqual(left, right) {
  let leftBuffer = Buffer.from(String(left || ''), 'utf8');
  let rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getSessionSecret() {
  return toTrimmedString(config.auth.userSessionSecret)
    || toTrimmedString(config.auth.adminSessionSecret)
    || fallbackSessionSecret;
}

function signPayload(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function encodePayload(sessionData) {
  return Buffer.from(JSON.stringify(sessionData), 'utf8').toString('base64url');
}

function decodePayload(payload) {
  try {
    let jsonString = Buffer.from(String(payload || ''), 'base64url').toString('utf8');
    let parsed = JSON.parse(jsonString);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    return null;
  }
}

function buildSessionToken(user) {
  let safeUser = user && typeof user === 'object' ? user : {};
  let userId = toTrimmedString(safeUser._id || safeUser.id);
  let email = toTrimmedString(safeUser.email).toLowerCase();
  let name = toTrimmedString(safeUser.name);

  if (!userId || !email) {
    return '';
  }

  let payload = encodePayload({
    userId: userId,
    email: email,
    name: name,
    issuedAt: Date.now(),
  });
  let signature = signPayload(payload, getSessionSecret());

  return payload + '.' + signature;
}

function parseAndVerifySessionToken(token) {
  let rawToken = toTrimmedString(token);
  let tokenParts = rawToken.split('.');
  let payload = tokenParts[0];
  let signature = tokenParts[1];
  let expectedSignature = '';
  let sessionData = null;
  let issuedAtMs = 0;
  let now = Date.now();

  if (tokenParts.length !== 2 || !payload || !signature) {
    return null;
  }

  expectedSignature = signPayload(payload, getSessionSecret());
  if (!timingSafeEqual(signature, expectedSignature)) {
    return null;
  }

  sessionData = decodePayload(payload);
  if (!sessionData) {
    return null;
  }

  let userId = toTrimmedString(sessionData.userId);
  let email = toTrimmedString(sessionData.email).toLowerCase();
  issuedAtMs = Number(sessionData.issuedAt);

  if (!userId || !email || !Number.isFinite(issuedAtMs) || issuedAtMs <= 0) {
    return null;
  }

  if (issuedAtMs > now + tokenClockSkewMs) {
    return null;
  }

  if ((now - issuedAtMs) > userCookieMaxAgeMs) {
    return null;
  }

  return {
    userId: userId,
    email: email,
    name: toTrimmedString(sessionData.name),
  };
}

function setUserAuthCookie(res, user) {
  let token = buildSessionToken(user);
  let isProduction = config.app.isProduction;

  if (!token) {
    return;
  }

  res.cookie(userCookieName, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: isProduction,
    maxAge: userCookieMaxAgeMs,
    path: '/',
  });
}

function clearUserAuthCookie(res) {
  res.clearCookie(userCookieName, {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
  });
}

function getAuthenticatedUserFromRequest(req) {
  let cookieValue = req && req.cookies ? req.cookies[userCookieName] : '';
  let session = parseAndVerifySessionToken(cookieValue);

  if (!session) {
    return null;
  }

  return {
    id: session.userId,
    email: session.email,
    name: session.name,
  };
}

function attachUserContext(req, res, next) {
  req.userAuth = getAuthenticatedUserFromRequest(req);
  res.locals.currentUser = req.userAuth;
  return next();
}

function requireUserAuth(req, res, next) {
  let authenticatedUser = req.userAuth && req.userAuth.email ? req.userAuth : null;

  if (authenticatedUser) {
    return next();
  }

  res.cookie(
    loginStateCookieName,
    JSON.stringify({
      statusCode: '',
      errorCode: 'login-required',
    }),
        {
          httpOnly: true,
          maxAge: 1000 * 60 * 30,
          path: '/login',
          sameSite: 'lax',
          secure: Boolean(req && req.secure) || config.app.isProduction,
        }
      );

  return res.redirect('/login');
}
export default {
  attachUserContext: attachUserContext,
  clearUserAuthCookie: clearUserAuthCookie,
  getAuthenticatedUserFromRequest: getAuthenticatedUserFromRequest,
  requireUserAuth: requireUserAuth,
  setUserAuthCookie: setUserAuthCookie,
  userCookieName: userCookieName,
};
