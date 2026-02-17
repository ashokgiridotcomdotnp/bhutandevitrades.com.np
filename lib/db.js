var mongoose = require('mongoose');

var hasLoggedConnection = false;

async function connectToDatabase() {
  var mongoUri = String(process.env.MONGODB_URI || '').trim();

  if (!mongoUri) {
    return false;
  }

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    return true;
  }

  try {
    await mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 5000,
      autoIndex: true,
    });

    if (!hasLoggedConnection) {
      console.log('MongoDB connected');
      hasLoggedConnection = true;
    }

    return true;
  } catch (error) {
    console.error('MongoDB connection failed:', error.message);
    return false;
  }
}

module.exports = {
  connectToDatabase: connectToDatabase,
};
