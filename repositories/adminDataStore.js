var fs = require('fs');
var path = require('path');
var database = require('../lib/db');
var AdminState = require('../models/AdminState');

var adminDataFilePath = path.join(__dirname, '..', 'data', 'admin-data.json');
var adminStateKey = 'catalog-admin-data';

function normalizePayload(value, normalizeData, createDefaultData) {
  if (typeof normalizeData === 'function') {
    return normalizeData(value);
  }

  if (value && typeof value === 'object') {
    return value;
  }

  return typeof createDefaultData === 'function' ? createDefaultData() : {};
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
    var state = await AdminState.findOne({ key: adminStateKey }).lean();
    var stateValue = null;

    if (state && state.value && typeof state.value === 'object') {
      stateValue = state.value;
    } else if (state && state.payload && typeof state.payload === 'object') {
      // Backward compatibility for old documents saved with `payload`.
      stateValue = state.payload;
    }

    if (!stateValue) {
      return null;
    }

    return normalizePayload(stateValue, normalizeData, createDefaultData);
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
      { key: adminStateKey },
      {
        $set: {
          value: normalizedData,
          updatedAt: new Date(),
        },
        $setOnInsert: {
          key: adminStateKey,
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

    return true;
  } catch (error) {
    console.error('Failed to save admin data to database:', error.message);
    return false;
  }
}

module.exports = {
  loadFromDatabase: loadFromDatabase,
  loadFromFile: loadFromFile,
  saveToDatabase: saveToDatabase,
  saveToFile: saveToFile,
};
