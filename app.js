require('dotenv').config({ quiet: true });

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var helmet = require('helmet');
var compression = require('compression');
var rateLimit = require('express-rate-limit');
var database = require('./lib/db');
var userAuth = require('./lib/userAuth');

var indexRouter = require('./routes/index');

var app = express();

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

app.disable('x-powered-by');
app.use(logger('dev'));

// Security headers with Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "https://res.cloudinary.com", "data:", "blob:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  referrerPolicy: {
    policy: 'strict-origin-when-cross-origin',
  },
}));

// Rate limiting for auth endpoints
var authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window
  message: 'Too many attempts from this IP, please try again after 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
});

var apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
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

// Caching headers for static assets
app.use(function (req, res, next) {
  if (req.path.startsWith('/uploads/') || req.path.startsWith('/images/')) {
    res.set('Cache-Control', 'public, max-age=604800, immutable'); // 7 days
  } else if (req.path.startsWith('/stylesheets/') || req.path.startsWith('/javascripts/')) {
    res.set('Cache-Control', 'public, max-age=86400'); // 1 day
  }
  next();
});

app.use(userAuth.attachUserContext);
app.use(express.static(path.join(__dirname, 'public'), {
  etag: true,
  maxAge: '1d',
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
