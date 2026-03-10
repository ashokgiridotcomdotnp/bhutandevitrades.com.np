require('dotenv').config({ quiet: true });

var createError = require('http-errors');
var express = require('express');
var fs = require('fs');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var helmet = require('helmet');
var compression = require('compression');
var rateLimit = require('express-rate-limit');
var database = require('./lib/db');
var userAuth = require('./lib/userAuth');
var requestSanitizer = require('./lib/requestSanitizer');

var indexRouter = require('./routes/index');

var app = express();
var publicDirectory = path.join(__dirname, 'public');
var deploymentAssetVersion = process.env.ASSET_VERSION && process.env.ASSET_VERSION.trim()
  ? process.env.ASSET_VERSION.trim()
  : '';

// Trust proxy for secure cookie support behind reverse proxy
app.set('trust proxy', 1);

database.connectToDatabase().catch(function (error) {
  if (error && error.message) {
    console.error('Initial MongoDB connect failed:', error.message);
  } else {
    console.error('Initial MongoDB connect failed');
  }
});

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

function normalizeAssetPath(assetPath) {
  if (typeof assetPath !== 'string' || !assetPath.trim()) {
    return null;
  }

  var normalizedAssetPath = path.posix.normalize(assetPath.charAt(0) === '/' ? assetPath : '/' + assetPath);

  if (normalizedAssetPath.indexOf('..') !== -1) {
    return null;
  }

  return normalizedAssetPath;
}

function resolvePublicAssetPath(assetPath) {
  var normalizedAssetPath = normalizeAssetPath(assetPath);
  var absoluteAssetPath;

  if (!normalizedAssetPath) {
    return null;
  }

  absoluteAssetPath = path.resolve(publicDirectory, '.' + normalizedAssetPath);

  if (absoluteAssetPath !== publicDirectory && absoluteAssetPath.indexOf(publicDirectory + path.sep) !== 0) {
    return null;
  }

  return absoluteAssetPath;
}

function getAssetVersion(assetPath) {
  var absoluteAssetPath;
  var assetStat;

  if (deploymentAssetVersion) {
    return deploymentAssetVersion;
  }

  absoluteAssetPath = resolvePublicAssetPath(assetPath);

  if (!absoluteAssetPath) {
    return 'dev';
  }

  try {
    assetStat = fs.statSync(absoluteAssetPath);
    return assetStat.size.toString(36) + '-' + Math.round(assetStat.mtimeMs).toString(36);
  } catch (error) {
    return 'dev';
  }
}

function buildAssetPath(assetPath) {
  var normalizedAssetPath = normalizeAssetPath(assetPath);

  if (!normalizedAssetPath) {
    return assetPath;
  }

  return normalizedAssetPath + '?v=' + encodeURIComponent(getAssetVersion(normalizedAssetPath));
}

function isSecureTransportRequest(req) {
  var forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
  return req.secure || forwardedProto === 'https';
}

function createContentSecurityPolicyDirectives(enableHttpsUpgrade) {
  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    formAction: ["'self'"],
    frameAncestors: ["'self'"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    scriptSrc: ["'self'", "'unsafe-inline'"],
    scriptSrcAttr: ["'none'"],
    imgSrc: ["'self'", "https://res.cloudinary.com", "data:", "blob:", "https:"],
    connectSrc: ["'self'"],
    fontSrc: ["'self'", "https://fonts.gstatic.com"],
    objectSrc: ["'none'"],
    mediaSrc: ["'self'"],
    frameSrc: ["'none'"],
    upgradeInsecureRequests: enableHttpsUpgrade ? [] : null,
  };
}

function createHelmetMiddleware(enableHttpsUpgrade) {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: createContentSecurityPolicyDirectives(enableHttpsUpgrade),
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: {
      policy: 'strict-origin-when-cross-origin',
    },
    strictTransportSecurity: enableHttpsUpgrade
      ? {
          maxAge: 31536000,
          includeSubDomains: true,
          preload: true,
        }
      : false,
  });
}

var secureHelmetMiddleware = createHelmetMiddleware(true);
var localHelmetMiddleware = createHelmetMiddleware(false);

app.locals.assetPath = buildAssetPath;

app.disable('x-powered-by');
app.use(logger('dev'));

// Security headers with Helmet
app.use(function (req, res, next) {
  if (isSecureTransportRequest(req)) {
    return secureHelmetMiddleware(req, res, next);
  }

  return localHelmetMiddleware(req, res, next);
});

// Rate limiting for auth endpoints
var authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: 'Too many attempts from this IP, please try again after 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

function isStaticAssetPath(pathname) {
  return pathname.startsWith('/stylesheets/')
    || pathname.startsWith('/javascripts/')
    || pathname.startsWith('/images/')
    || pathname.startsWith('/icons/')
    || pathname.startsWith('/uploads/')
    || pathname === '/favicon.ico';
}

var apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: function (req) {
    return isStaticAssetPath(req.path || '');
  },
});

app.use('/login', authLimiter);
app.use('/admin/login', authLimiter);
app.use('/signup', authLimiter);
app.use('/forgot-password', authLimiter);
app.use(apiLimiter);

// Compression
app.use(compression({ threshold: 1024 }));

// Request body size limits
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(cookieParser());
app.use(requestSanitizer.sanitizeRequestPayload);

// Caching headers for static assets
app.use(function (req, res, next) {
  var isVersionedAssetRequest = /(?:^|[?&])v=[^&]+/.test(req.originalUrl || '');

  if (req.path.startsWith('/stylesheets/') || req.path.startsWith('/javascripts/')) {
    res.set('Cache-Control', isVersionedAssetRequest ? 'public, max-age=31536000, immutable' : 'public, max-age=0, must-revalidate');
  } else if (req.path.startsWith('/images/') || req.path.startsWith('/icons/')) {
    res.set('Cache-Control', isVersionedAssetRequest ? 'public, max-age=31536000, immutable' : 'public, max-age=604800');
  } else if (req.path.startsWith('/uploads/')) {
    res.set('Cache-Control', 'public, max-age=3600');
  }

  next();
});

app.use(userAuth.attachUserContext);
app.use(express.static(publicDirectory, {
  etag: true,
  lastModified: true,
  cacheControl: false,
}));

app.use('/', indexRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  var statusCode = err.status || 500;
  var safeRequestedPath = '/';
  var isDevelopmentEnv = req.app.get('env') === 'development';

  if (req && typeof req.path === 'string' && req.path.trim()) {
    safeRequestedPath = req.path.trim();
  }

  if (safeRequestedPath.length > 180) {
    safeRequestedPath = safeRequestedPath.slice(0, 180) + '...';
  }

  res.set('Cache-Control', 'private, no-store');
  res.status(statusCode);

  if (statusCode === 404) {
    return res.render('404', { requestedPath: safeRequestedPath });
  }

  // set locals, only providing error in development
  res.locals.message = isDevelopmentEnv
    ? err.message
    : (statusCode >= 500 ? 'Something went wrong. Please try again later.' : err.message);
  res.locals.error = isDevelopmentEnv ? err : {};
  res.locals.statusCode = statusCode;

  // render the error page
  res.render('error');
});

module.exports = app;
