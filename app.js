import createError from 'http-errors';
import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import config from './lib/config.js';
import database from './lib/db.js';
import logger from './lib/logger.js';
import userAuth from './lib/userAuth.js';
import requestSanitizer from './lib/requestSanitizer.js';
import indexRouter from './routes/index.js';
import { fileURLToPath } from 'node:url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);




let app = express();
let publicDirectory = path.join(__dirname, 'public');
let deploymentAssetVersion = config.app.assetVersion;

// Trust proxy for secure cookie support behind reverse proxy
app.set('trust proxy', config.app.trustProxy);

config.getStartupWarnings().forEach(function (warningMessage) {
  logger.warn(warningMessage);
});

database.connectToDatabase().catch(function (error) {
  logger.error('Initial MongoDB connect failed', {
    error: logger.serializeError(error),
  });
});

// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

function normalizeAssetPath(assetPath) {
  if (typeof assetPath !== 'string' || !assetPath.trim()) {
    return null;
  }

  let normalizedAssetPath = path.posix.normalize(assetPath.charAt(0) === '/' ? assetPath : '/' + assetPath);

  if (normalizedAssetPath.indexOf('..') !== -1) {
    return null;
  }

  return normalizedAssetPath;
}

function resolvePublicAssetPath(assetPath) {
  let normalizedAssetPath = normalizeAssetPath(assetPath);
  let absoluteAssetPath;

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
  let absoluteAssetPath;
  let assetStat;

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
  let normalizedAssetPath = normalizeAssetPath(assetPath);

  if (!normalizedAssetPath) {
    return assetPath;
  }

  return normalizedAssetPath + '?v=' + encodeURIComponent(getAssetVersion(normalizedAssetPath));
}

function isSecureTransportRequest(req) {
  if (!req) {
    return false;
  }

  // Rely on Express' protocol detection (which honors `trust proxy`), instead of trusting
  // user-controlled forwarded headers directly.
  return Boolean(req.secure || req.protocol === 'https');
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

let secureHelmetMiddleware = createHelmetMiddleware(true);
let localHelmetMiddleware = createHelmetMiddleware(false);

app.locals.assetPath = buildAssetPath;

app.disable('x-powered-by');
app.use(function (req, res, next) {
  req.requestId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : String(Date.now()) + '-' + Math.round(Math.random() * 1e9);
  res.locals.requestId = req.requestId;
  res.set('X-Request-Id', req.requestId);
  next();
});

let logHttpSuccess = /^(1|true|yes|on)$/i.test(String(process.env.LOG_HTTP_SUCCESS || '').trim());
app.use(morgan(':method :url :status :response-time ms - :res[content-length]', {
  stream: {
    write: function (message) {
      logger.http(message.trim());
    },
  },
  skip: function (req, res) {
    let statusCode = Number(res && res.statusCode);

    if (req && typeof req.path === 'string' && req.path === '/favicon.ico') {
      return true;
    }

    if (!logHttpSuccess && Number.isFinite(statusCode) && statusCode < 400) {
      return true;
    }

    return isStaticAssetPath(req && typeof req.path === 'string' ? req.path : '')
      && Number.isFinite(statusCode)
      && statusCode < 400;
  },
}));

// Security headers with Helmet
app.use(function (req, res, next) {
  if (isSecureTransportRequest(req)) {
    return secureHelmetMiddleware(req, res, next);
  }

  return localHelmetMiddleware(req, res, next);
});

// Rate limiting for auth endpoints
let authLimiter = rateLimit({
  windowMs: config.app.authRateLimitWindowMs,
  max: config.app.authRateLimitMax,
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

let apiLimiter = rateLimit({
  windowMs: config.app.apiRateLimitWindowMs,
  max: config.app.apiRateLimitMax,
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
app.use(express.json({ limit: config.app.jsonBodyLimit }));
app.use(express.urlencoded({ extended: false, limit: config.app.urlencodedBodyLimit }));
app.use(cookieParser());
app.use(requestSanitizer.sanitizeRequestPayload);

// Caching headers for static assets
app.use(function (req, res, next) {
  let isVersionedAssetRequest = /(?:^|[?&])v=[^&]+/.test(req.originalUrl || '');

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
  let statusCode = err.status || err.statusCode || 500;
  let safeRequestedPath = '/';
  let isDevelopmentEnv = req.app.get('env') === 'development';
  let isJsonRequest = Boolean(
    req
    && (
      req.xhr
      || String(req.get('accept') || '').toLowerCase().indexOf('application/json') !== -1
    )
  );

  if (req && typeof req.path === 'string' && req.path.trim()) {
    safeRequestedPath = req.path.trim();
  }

  if (safeRequestedPath.length > 180) {
    safeRequestedPath = safeRequestedPath.slice(0, 180) + '...';
  }

  res.set('Cache-Control', 'private, no-store');
  res.status(statusCode);

  if (statusCode === 404 && isStaticAssetPath(safeRequestedPath)) {
    return res.end();
  }

  let serializedError = statusCode >= 500
    ? logger.serializeError(err)
    : {
        name: String((err && err.name) || 'Error'),
        message: String((err && err.message) || ''),
      };

  if (statusCode >= 500) {
    console.error('[ERROR]', {
      route: req && req.originalUrl ? req.originalUrl : '',
      method: req && req.method ? req.method : '',
      message: err && err.message ? err.message : 'Unhandled request error',
      stack: err && err.stack ? err.stack : '',
      timestamp: new Date().toISOString(),
      requestId: req && req.requestId ? req.requestId : '',
    });

    logger.error('Unhandled request error', {
      requestId: req && req.requestId ? req.requestId : '',
      method: req && req.method ? req.method : '',
      path: safeRequestedPath,
      error: serializedError,
    });
  } else {
    logger.warn('Handled request error', {
      requestId: req && req.requestId ? req.requestId : '',
      method: req && req.method ? req.method : '',
      path: safeRequestedPath,
      statusCode: statusCode,
      error: serializedError,
    });
  }

  if (statusCode === 404) {
    return res.render('404', { requestedPath: safeRequestedPath });
  }

  if (isJsonRequest) {
    return res.json({
      ok: false,
      errorCode: err && err.code ? err.code : 'internal-error',
      message: statusCode >= 500
        ? 'Something went wrong. Please try again later.'
        : (err && err.message ? err.message : 'Request failed'),
      requestId: req && req.requestId ? req.requestId : '',
    });
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
export default app;
