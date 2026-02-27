var crypto = require('crypto');

var userCookieName = 'bd_user_session';
var userCookieMaxAgeMs = 1000 * 60 * 60 * 24 * 30; // 30 days
var loginStateCookieName = 'bd_login_state';
var fallbackSessionSecret = crypto.randomBytes(32).toString('hex');
var tokenClockSkewMs = 1000 * 60 * 5; // 5 minutes

function toTrimmedString(value) {
  return String(value || '').trim();
}

function timingSafeEqual(left, right) {
  var leftBuffer = Buffer.from(String(left || ''), 'utf8');
  var rightBuffer = Buffer.from(String(right || ''), 'utf8');

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function getSessionSecret() {
  return toTrimmedString(process.env.USER_SESSION_SECRET)
    || toTrimmedString(process.env.ADMIN_SESSION_SECRET)
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
    var jsonString = Buffer.from(String(payload || ''), 'base64url').toString('utf8');
    var parsed = JSON.parse(jsonString);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (error) {
    return null;
  }
}

function buildSessionToken(user) {
  var safeUser = user && typeof user === 'object' ? user : {};
  var userId = toTrimmedString(safeUser._id || safeUser.id);
  var email = toTrimmedString(safeUser.email).toLowerCase();
  var name = toTrimmedString(safeUser.name);

  if (!userId || !email) {
    return '';
  }

  var payload = encodePayload({
    userId: userId,
    email: email,
    name: name,
    issuedAt: Date.now(),
  });
  var signature = signPayload(payload, getSessionSecret());

  return payload + '.' + signature;
}

function parseAndVerifySessionToken(token) {
  var rawToken = toTrimmedString(token);
  var tokenParts = rawToken.split('.');
  var payload = tokenParts[0];
  var signature = tokenParts[1];
  var expectedSignature = '';
  var sessionData = null;
  var issuedAtMs = 0;
  var now = Date.now();

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

  var userId = toTrimmedString(sessionData.userId);
  var email = toTrimmedString(sessionData.email).toLowerCase();
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
  var token = buildSessionToken(user);
  var isProduction = process.env.NODE_ENV === 'production';

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
  var cookieValue = req && req.cookies ? req.cookies[userCookieName] : '';
  var session = parseAndVerifySessionToken(cookieValue);

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
  var authenticatedUser = req.userAuth && req.userAuth.email ? req.userAuth : null;

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
      secure: Boolean(req && req.secure),
    }
  );

  return res.redirect('/login');
}

module.exports = {
  attachUserContext: attachUserContext,
  clearUserAuthCookie: clearUserAuthCookie,
  getAuthenticatedUserFromRequest: getAuthenticatedUserFromRequest,
  requireUserAuth: requireUserAuth,
  setUserAuthCookie: setUserAuthCookie,
  userCookieName: userCookieName,
};
