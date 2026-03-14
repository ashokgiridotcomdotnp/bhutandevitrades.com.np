import dotenv from 'dotenv';
dotenv.config({ quiet: true });


function toTrimmedString(value) {
  return String(value || '').trim();
}

function readString(name, fallbackValue) {
  let resolvedValue = toTrimmedString(process.env[name]);

  if (resolvedValue) {
    return resolvedValue;
  }

  return typeof fallbackValue === 'string' ? fallbackValue : '';
}

function readBoolean(name, fallbackValue) {
  let resolvedValue = toTrimmedString(process.env[name]).toLowerCase();

  if (!resolvedValue) {
    return Boolean(fallbackValue);
  }

  return resolvedValue === '1'
    || resolvedValue === 'true'
    || resolvedValue === 'yes'
    || resolvedValue === 'on';
}

function readInteger(name, fallbackValue, minimumValue) {
  let parsedValue = Number(process.env[name]);
  let resolvedMinimum = Number.isFinite(minimumValue) ? minimumValue : null;

  if (!Number.isFinite(parsedValue)) {
    return fallbackValue;
  }

  parsedValue = Math.floor(parsedValue);

  if (resolvedMinimum !== null && parsedValue < resolvedMinimum) {
    return fallbackValue;
  }

  return parsedValue;
}

let nodeEnv = readString('NODE_ENV', 'development');
let isProduction = nodeEnv === 'production';
let config = {
  app: {
    nodeEnv: nodeEnv,
    isProduction: isProduction,
    port: readString('PORT', '3000'),
    assetVersion: readString('ASSET_VERSION', ''),
    jsonBodyLimit: readString('JSON_BODY_LIMIT', '100kb'),
    urlencodedBodyLimit: readString('URLENCODED_BODY_LIMIT', '100kb'),
    trustProxy: readInteger('TRUST_PROXY_HOPS', 1, 0),
    authRateLimitWindowMs: readInteger('AUTH_RATE_LIMIT_WINDOW_MS', 15 * 60 * 1000, 1),
    authRateLimitMax: readInteger('AUTH_RATE_LIMIT_MAX', 10, 1),
    apiRateLimitWindowMs: readInteger('API_RATE_LIMIT_WINDOW_MS', 60 * 1000, 1),
    apiRateLimitMax: readInteger('API_RATE_LIMIT_MAX', 60, 1),
  },
  db: {
    uri: readString('MONGODB_URI', ''),
    serverSelectionTimeoutMs: readInteger('MONGODB_SERVER_SELECTION_TIMEOUT_MS', 10000, 1),
    maxPoolSize: readInteger('MONGODB_MAX_POOL_SIZE', 10, 1),
    minPoolSize: readInteger('MONGODB_MIN_POOL_SIZE', 2, 0),
    socketTimeoutMs: readInteger('MONGODB_SOCKET_TIMEOUT_MS', 45000, 1),
    autoIndex: readBoolean('MONGODB_AUTO_INDEX', !isProduction),
  },
  auth: {
    userSessionSecret: readString('USER_SESSION_SECRET', ''),
    adminSessionSecret: readString('ADMIN_SESSION_SECRET', ''),
    emailOtpSecret: readString('EMAIL_OTP_SECRET', ''),
    adminUsername: readString('ADMIN_USERNAME', ''),
    adminPassword: readString('ADMIN_PASSWORD', ''),
    adminAuthDisabled: readBoolean('ADMIN_AUTH_DISABLED', false),
  },
  catalog: {
    cacheTtlMs: readInteger('CATALOG_CACHE_TTL_MS', 15000, 0),
    cloudinaryUploadFolder: readString('CLOUDINARY_PRODUCT_UPLOAD_FOLDER', 'bhutandevi/products'),
    cloudinaryUploadTimeoutMs: readInteger('CLOUDINARY_UPLOAD_TIMEOUT_MS', 3500, 0),
  },
  resend: {
    apiKey: readString('RESEND_API_KEY', ''),
    fromEmail: readString('RESEND_FROM_EMAIL', 'onboarding@resend.dev'),
    timeoutMs: readInteger('RESEND_TIMEOUT_MS', 9000, 1),
  },
  cloudinary: {
    cloudName: readString('CLOUDINARY_CLOUD_NAME', ''),
    apiKey: readString('CLOUDINARY_API_KEY', ''),
    apiSecret: readString('CLOUDINARY_API_SECRET', ''),
  },
  store: {
    requireEmailVerification: readBoolean('REQUIRE_EMAIL_VERIFICATION', false),
    whatsappNumber: readString('STORE_WHATSAPP_NUMBER', readString('WHATSAPP_NUMBER', '')),
    orderNotificationEmail: readString(
      'ORDER_NOTIFICATION_EMAIL',
      readString('ORDER_GMAIL', readString('STORE_ORDER_EMAIL', ''))
    ),
  },
};

function getStartupWarnings() {
  let warnings = [];

  if (!config.db.uri) {
    warnings.push('MONGODB_URI is not configured. Database-backed features will be unavailable.');
  }

  if (!config.auth.userSessionSecret) {
    warnings.push('USER_SESSION_SECRET is not configured. User sessions will use an ephemeral fallback secret.');
  }

  if (!config.auth.adminSessionSecret) {
    warnings.push('ADMIN_SESSION_SECRET is not configured. Admin sessions will use an ephemeral fallback secret.');
  }

  if (!config.auth.adminAuthDisabled && (!config.auth.adminUsername || !config.auth.adminPassword)) {
    warnings.push('ADMIN_USERNAME or ADMIN_PASSWORD is missing. Admin login will not be available.');
  }

  return warnings;
}
export default {
  app: config.app,
  auth: config.auth,
  catalog: config.catalog,
  cloudinary: config.cloudinary,
  db: config.db,
  resend: config.resend,
  store: config.store,
  getStartupWarnings: getStartupWarnings,
};
