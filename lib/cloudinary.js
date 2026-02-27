var cloudinary = require('cloudinary').v2;

function toTrimmedString(value) {
  return String(value || '').trim();
}

function isPlaceholderValue(value) {
  if (!value) {
    return true;
  }

  return /^your_/i.test(value);
}

function readCloudinaryConfigFromEnv() {
  return {
    cloudName: toTrimmedString(process.env.CLOUDINARY_CLOUD_NAME),
    apiKey: toTrimmedString(process.env.CLOUDINARY_API_KEY),
    apiSecret: toTrimmedString(process.env.CLOUDINARY_API_SECRET),
  };
}

function isCloudinaryConfigured() {
  var config = readCloudinaryConfigFromEnv();

  return Boolean(config.cloudName) &&
    Boolean(config.apiKey) &&
    Boolean(config.apiSecret) &&
    !isPlaceholderValue(config.cloudName) &&
    !isPlaceholderValue(config.apiKey) &&
    !isPlaceholderValue(config.apiSecret);
}

function configureCloudinary() {
  var config = readCloudinaryConfigFromEnv();

  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
  });
}

if (isCloudinaryConfigured()) {
  configureCloudinary();
}

module.exports = {
  cloudinary: cloudinary,
  isCloudinaryConfigured: isCloudinaryConfigured,
};
