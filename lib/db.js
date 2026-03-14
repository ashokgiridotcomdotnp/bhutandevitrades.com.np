import mongoose from 'mongoose';
import config from './config.js';
import logger from './logger.js';


mongoose.set('strictQuery', true);
mongoose.set('sanitizeFilter', true);

let hasLoggedConnection = false;
let connectPromise = null;
let hasBoundEvents = false;

function bindConnectionEvents() {
  if (hasBoundEvents || !mongoose.connection) {
    return;
  }

  hasBoundEvents = true;

  mongoose.connection.on('connected', function () {
    if (!hasLoggedConnection) {
      logger.info('MongoDB connected');
      hasLoggedConnection = true;
    }
  });

  mongoose.connection.on('disconnected', function () {
    if (hasLoggedConnection) {
      logger.warn('MongoDB disconnected');
    }
    hasLoggedConnection = false;
  });

  mongoose.connection.on('error', function (error) {
    logger.error('MongoDB connection error', {
      error: logger.serializeError(error),
    });
  });
}

async function connectToDatabase() {
  let mongoUri = config.db.uri;

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
        serverSelectionTimeoutMS: config.db.serverSelectionTimeoutMs,
        maxPoolSize: config.db.maxPoolSize,
        minPoolSize: config.db.minPoolSize,
        socketTimeoutMS: config.db.socketTimeoutMs,
        autoIndex: config.db.autoIndex,
      });

      if (!hasLoggedConnection) {
        logger.info('MongoDB connected');
        hasLoggedConnection = true;
      }

      return true;
    } catch (error) {
      logger.error('MongoDB connection failed', {
        error: logger.serializeError(error),
      });
      hasLoggedConnection = false;
      return false;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}
export default {
  connectToDatabase: connectToDatabase,
};
