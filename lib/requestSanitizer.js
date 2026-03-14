function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isDangerousKey(key) {
  let normalizedKey = String(key || '').trim().toLowerCase();

  if (!normalizedKey) {
    return true;
  }

  return (
    normalizedKey.charAt(0) === '$' ||
    normalizedKey.indexOf('.') !== -1 ||
    normalizedKey === '__proto__' ||
    normalizedKey === 'prototype' ||
    normalizedKey === 'constructor'
  );
}

function sanitizeValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeValue);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  let output = {};

  Object.keys(value).forEach(function (key) {
    if (isDangerousKey(key)) {
      return;
    }

    output[key] = sanitizeValue(value[key]);
  });

  return output;
}

function sanitizeRequestPayload(req, res, next) {
  if (isPlainObject(req.body)) {
    req.body = sanitizeValue(req.body);
  }

  if (isPlainObject(req.query)) {
    req.query = sanitizeValue(req.query);
  }

  if (isPlainObject(req.params)) {
    req.params = sanitizeValue(req.params);
  }

  return next();
}
export default {
  sanitizeRequestPayload: sanitizeRequestPayload,
  sanitizeValue: sanitizeValue,
};
