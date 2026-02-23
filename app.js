require('dotenv').config({ quiet: true });

var createError = require('http-errors');
var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var helmet = require('helmet');
var compression = require('compression');
var database = require('./lib/db');
var userAuth = require('./lib/userAuth');

var indexRouter = require('./routes/index');

var app = express();

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
app.use(helmet({
  // This app currently relies on inline scripts/styles and third-party font assets.
  // Keep CSP off until explicit nonces/hashes are implemented.
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(compression({ threshold: 1024 }));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(userAuth.attachUserContext);
app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

module.exports = app;
