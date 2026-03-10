var mongoose = require('mongoose');

mongoose.set('strictQuery', true);
mongoose.set('sanitizeFilter', true);

var hasLoggedConnection = false;
var connectPromise = null;
var hasBoundEvents = false;

function bindConnectionEvents() {
  if (hasBoundEvents || !mongoose.connection) {
    return;
  }

  hasBoundEvents = true;

  mongoose.connection.on('connected', function () {
    if (!hasLoggedConnection) {
      console.log('MongoDB connected');
      hasLoggedConnection = true;
    }
  });

  mongoose.connection.on('disconnected', function () {
    if (hasLoggedConnection) {
      console.warn('MongoDB disconnected');
    }
    hasLoggedConnection = false;
  });

  mongoose.connection.on('error', function (error) {
    if (error && error.message) {
      console.error('MongoDB connection error:', error.message);
    }
  });
}

async function connectToDatabase() {
  var mongoUri = String(process.env.MONGODB_URI || '').trim();

  if (!mongoUri) {
    return false;
  }

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    return true;
  }

  if (connectPromise) {
    return connectPromise;
  }

  bindConnectionEvents();

  connectPromise = (async function () {
    try {
      await mongoose.connect(mongoUri, {
        serverSelectionTimeoutMS: 10000,
        maxPoolSize: 10,
        minPoolSize: 2,
        socketTimeoutMS: 45000,
        autoIndex: true,
      });

      if (!hasLoggedConnection) {
        console.log('MongoDB connected');
        hasLoggedConnection = true;
      }

      return true;
    } catch (error) {
      console.error('MongoDB connection failed:', error.message);
      hasLoggedConnection = false;
      return false;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}

module.exports = {
  connectToDatabase: connectToDatabase,
};
