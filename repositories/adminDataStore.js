var fs = require('fs');
var path = require('path');
var database = require('../lib/db');
var AdminState = require('../models/AdminState');

var adminDataFilePath = path.join(__dirname, '..', 'data', 'admin-data.json');
var adminStateDocumentKey = 'catalog-admin-state';
var legacyAdminStateDocumentKeys = ['catalog-admin-data'];

function normalizePayload(value, normalizeData, createDefaultData) {
  if (typeof normalizeData === 'function') {
    return normalizeData(value);
  }

  if (value && typeof value === 'object') {
    return value;
  }

  return typeof createDefaultData === 'function' ? createDefaultData() : {};
}

function resolveStateValue(state) {
  if (state && state.value && typeof state.value === 'object') {
    return state.value;
  }

  if (state && state.payload && typeof state.payload === 'object') {
    // Backward compatibility for old documents saved with `payload`.
    return state.payload;
  }

  return null;
}

async function migrateLegacyDocumentKeyIfNeeded(state, normalizedState) {
  if (!state || !state.key || state.key === adminStateDocumentKey) {
    return;
  }

  try {
    await AdminState.findOneAndUpdate(
      { key: adminStateDocumentKey },
      {
        $set: {
          value: normalizedState,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          key: adminStateDocumentKey,
        },
        $unset: {
          payload: 1,
        },
      },
      {
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    if (state._id) {
      await AdminState.deleteOne({ _id: state._id });
    }
  } catch (error) {
    console.error('Failed to migrate legacy admin data document key:', error.message);
  }
}

function loadFromFile(createDefaultData, normalizeData) {
  try {
    if (!fs.existsSync(adminDataFilePath)) {
      return typeof createDefaultData === 'function' ? createDefaultData() : {};
    }

    var content = fs.readFileSync(adminDataFilePath, 'utf8');
    if (!content.trim()) {
      return typeof createDefaultData === 'function' ? createDefaultData() : {};
    }

    return normalizePayload(JSON.parse(content), normalizeData, createDefaultData);
  } catch (error) {
    console.error('Failed to load admin data from file:', error.message);
    return typeof createDefaultData === 'function' ? createDefaultData() : {};
  }
}

async function loadFromFileAsync(createDefaultData, normalizeData) {
  try {
    var content = await fs.promises.readFile(adminDataFilePath, 'utf8');
    if (!content.trim()) {
      return typeof createDefaultData === 'function' ? createDefaultData() : {};
    }

    return normalizePayload(JSON.parse(content), normalizeData, createDefaultData);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      return typeof createDefaultData === 'function' ? createDefaultData() : {};
    }

    console.error('Failed to load admin data from file:', error.message);
    return typeof createDefaultData === 'function' ? createDefaultData() : {};
  }
}

async function saveToFile(data, normalizeData, createDefaultData) {
  try {
    var directoryPath = path.dirname(adminDataFilePath);
    var normalizedData = normalizePayload(data, normalizeData, createDefaultData);
    await fs.promises.mkdir(directoryPath, { recursive: true });
    await fs.promises.writeFile(adminDataFilePath, JSON.stringify(normalizedData, null, 2) + '\n', 'utf8');
    return true;
  } catch (error) {
    console.error('Failed to save admin data to file:', error.message);
    return false;
  }
}

async function loadFromDatabase(normalizeData, createDefaultData) {
  var isConnected = await database.connectToDatabase();
  if (!isConnected) {
    return null;
  }

  try {
    var state = await AdminState.findOne({ key: adminStateDocumentKey })
      .sort({ updatedAt: -1 })
      .lean();
    var stateValue = resolveStateValue(state);

    if (!stateValue && legacyAdminStateDocumentKeys.length > 0) {
      var legacyState = await AdminState.findOne({ key: { $in: legacyAdminStateDocumentKeys } })
        .sort({ updatedAt: -1 })
        .lean();
      var legacyStateValue = resolveStateValue(legacyState);

      if (legacyStateValue) {
        state = legacyState;
        stateValue = legacyStateValue;
      }
    }

    if (!stateValue) {
      return null;
    }

    var normalizedState = normalizePayload(stateValue, normalizeData, createDefaultData);
    await migrateLegacyDocumentKeyIfNeeded(state, normalizedState);
    return normalizedState;
  } catch (error) {
    console.error('Failed to load admin data from database:', error.message);
    return null;
  }
}

async function saveToDatabase(data, normalizeData, createDefaultData) {
  var isConnected = await database.connectToDatabase();
  if (!isConnected) {
    return false;
  }

  try {
    var normalizedData = normalizePayload(data, normalizeData, createDefaultData);

    await AdminState.findOneAndUpdate(
      { key: adminStateDocumentKey },
      {
        $set: {
          value: normalizedData,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          key: adminStateDocumentKey,
        },
        $unset: {
          payload: 1,
        },
      },
      {
        upsert: true,
        setDefaultsOnInsert: true,
      }
    );

    if (legacyAdminStateDocumentKeys.length > 0) {
      await AdminState.deleteMany({ key: { $in: legacyAdminStateDocumentKeys } });
    }

    return true;
  } catch (error) {
    console.error('Failed to save admin data to database:', error.message);
    return false;
  }
}

module.exports = {
  loadFromDatabase: loadFromDatabase,
  loadFromFile: loadFromFile,
  loadFromFileAsync: loadFromFileAsync,
  saveToDatabase: saveToDatabase,
  saveToFile: saveToFile,
};
