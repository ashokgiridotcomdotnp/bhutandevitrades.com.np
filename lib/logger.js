function buildEntry(level, message, context) {
  let entry = {
    timestamp: new Date().toISOString(),
    level: String(level || 'info').toLowerCase(),
    message: String(message || ''),
  };

  if (context && typeof context === 'object' && Object.keys(context).length) {
    entry.context = context;
  }

  return entry;
}

function write(level, message, context) {
  let entry = buildEntry(level, message, context);
  let line = JSON.stringify(entry);

  if (entry.level === 'error') {
    console.error(line);
    return;
  }

  if (entry.level === 'warn') {
    console.warn(line);
    return;
  }

  console.log(line);
}

function serializeError(error) {
  if (!error) {
    return null;
  }

  return {
    name: String(error.name || 'Error'),
    message: String(error.message || 'Unknown error'),
    stack: String(error.stack || ''),
  };
}
export default {
  debug: function (message, context) {
    write('debug', message, context);
  },
  error: function (message, context) {
    write('error', message, context);
  },
  http: function (message, context) {
    write('http', message, context);
  },
  info: function (message, context) {
    write('info', message, context);
  },
  serializeError: serializeError,
  warn: function (message, context) {
    write('warn', message, context);
  },
};
