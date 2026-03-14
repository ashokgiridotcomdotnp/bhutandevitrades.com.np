import config from './config.js';

import cloudinaryPkg from 'cloudinary';

const cloudinary = cloudinaryPkg.v2;

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
    cloudName: toTrimmedString(config.cloudinary.cloudName),
    apiKey: toTrimmedString(config.cloudinary.apiKey),
    apiSecret: toTrimmedString(config.cloudinary.apiSecret),
  };
}

function isCloudinaryConfigured() {
  let cloudinaryConfig = readCloudinaryConfigFromEnv();

  return Boolean(cloudinaryConfig.cloudName) &&
    Boolean(cloudinaryConfig.apiKey) &&
    Boolean(cloudinaryConfig.apiSecret) &&
    !isPlaceholderValue(cloudinaryConfig.cloudName) &&
    !isPlaceholderValue(cloudinaryConfig.apiKey) &&
    !isPlaceholderValue(cloudinaryConfig.apiSecret);
}

function configureCloudinary() {
  let cloudinaryConfig = readCloudinaryConfigFromEnv();

  cloudinary.config({
    cloud_name: cloudinaryConfig.cloudName,
    api_key: cloudinaryConfig.apiKey,
    api_secret: cloudinaryConfig.apiSecret,
  });
}

if (isCloudinaryConfigured()) {
  configureCloudinary();
}
export default {
  cloudinary: cloudinary,
  isCloudinaryConfigured: isCloudinaryConfigured,
};
