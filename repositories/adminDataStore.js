var mongoose = require('mongoose');
var fs = require('fs');
var path = require('path');
var database = require('../lib/db');
var AdminState = require('../models/AdminState');

var adminDataFilePath = path.join(__dirname, '..', 'data', 'admin-data.json');
var adminStateDocumentKey = 'catalog-admin-state';
var legacyAdminStateDocumentKeys = ['catalog-admin-data'];
var stateFlatFields = [
  'categories',
  'products',
  'deletedProductIds',
  'deletedCategoryNames',
  'priceOverrides',
  'imageOverrides',
  'productOverrides',
];
var stateFlatFieldDefaults = {
  categories: [],
  products: [],
  deletedProductIds: [],
  deletedCategoryNames: [],
  priceOverrides: {},
  imageOverrides: {},
  productOverrides: {},
};

function cloneFlatFieldDefaultValue(fieldName) {
  var defaultValue = stateFlatFieldDefaults[fieldName];

  if (Array.isArray(defaultValue)) {
    return [];
  }

  if (defaultValue && typeof defaultValue === 'object') {
    return {};
  }

  return defaultValue;
}

function buildLegacyAdminStateKeyFilter() {
  if (!Array.isArray(legacyAdminStateDocumentKeys) || legacyAdminStateDocumentKeys.length === 0) {
    return {};
  }

  if (legacyAdminStateDocumentKeys.length === 1) {
    return { key: legacyAdminStateDocumentKeys[0] };
  }

  return {
    key: mongoose.trusted({ $in: legacyAdminStateDocumentKeys }),
  };
}

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
  var flatState = null;

  if (state && state.value && typeof state.value === 'object') {
    return state.value;
  }

  if (state && state.payload && typeof state.payload === 'object') {
    // Backward compatibility for old documents saved with `payload`.
    return state.payload;
  }

  flatState = resolveFlatStateValue(state);
  if (flatState) {
    return flatState;
  }

  return null;
}

function resolveFlatStateValue(state) {
  var hasAnyFlatField = false;
  var result = {};

  if (!state || typeof state !== 'object') {
    return null;
  }

  stateFlatFields.forEach(function (fieldName) {
    if (!Object.prototype.hasOwnProperty.call(state, fieldName)) {
      return;
    }

    hasAnyFlatField = true;
    result[fieldName] = typeof state[fieldName] === 'undefined'
      ? cloneFlatFieldDefaultValue(fieldName)
      : state[fieldName];
  });

  return hasAnyFlatField ? result : null;
}

function buildFlatStatePayload(normalizedState) {
  var sourceState = normalizedState && typeof normalizedState === 'object' ? normalizedState : {};
  var payload = {};

  stateFlatFields.forEach(function (fieldName) {
    payload[fieldName] = typeof sourceState[fieldName] === 'undefined'
      ? cloneFlatFieldDefaultValue(fieldName)
      : sourceState[fieldName];
  });

  return payload;
}

function isLegacyNestedState(state) {
  if (!state || typeof state !== 'object') {
    return false;
  }

  return Boolean(
    (state.value && typeof state.value === 'object') ||
    (state.payload && typeof state.payload === 'object')
  );
}

async function migrateLegacyDocumentKeyIfNeeded(state, normalizedState) {
  if (!state || !state.key || state.key === adminStateDocumentKey) {
    return;
  }

  try {
    var flatPayload = buildFlatStatePayload(normalizedState);

    await AdminState.findOneAndUpdate(
      { key: adminStateDocumentKey },
      {
        $set: flatPayload,
        $setOnInsert: {
          key: adminStateDocumentKey,
        },
        $unset: {
          value: 1,
          payload: 1,
        },
      },
      {
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );

    if (state._id) {
      await AdminState.deleteOne({ _id: state._id });
    }
  } catch (error) {
    console.error('Failed to migrate legacy admin data document key:', error.message);
  }
}

async function migrateLegacyNestedStateIfNeeded(state, normalizedState) {
  if (!state || !state.key || state.key !== adminStateDocumentKey || !isLegacyNestedState(state)) {
    return;
  }

  try {
    var flatPayload = buildFlatStatePayload(normalizedState);

    await AdminState.findOneAndUpdate(
      { key: adminStateDocumentKey },
      {
        $set: flatPayload,
        $setOnInsert: {
          key: adminStateDocumentKey,
        },
        $unset: {
          value: 1,
          payload: 1,
        },
      },
      {
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );
  } catch (error) {
    console.error('Failed to migrate nested admin state fields:', error.message);
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
      var legacyState = await AdminState.findOne(buildLegacyAdminStateKeyFilter())
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
    await migrateLegacyNestedStateIfNeeded(state, normalizedState);
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
    var flatPayload = buildFlatStatePayload(normalizedData);

    await AdminState.findOneAndUpdate(
      { key: adminStateDocumentKey },
      {
        $set: flatPayload,
        $setOnInsert: {
          key: adminStateDocumentKey,
        },
        $unset: {
          value: 1,
          payload: 1,
        },
      },
      {
        upsert: true,
        setDefaultsOnInsert: true,
        runValidators: true,
      }
    );

    if (legacyAdminStateDocumentKeys.length > 0) {
      await AdminState.deleteMany(buildLegacyAdminStateKeyFilter());
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
