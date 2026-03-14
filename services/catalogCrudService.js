import mongoose from 'mongoose';
import database from '../lib/db.js';
import Category from '../models/Category.js';
import Brand from '../models/Brand.js';
import Product from '../models/Product.js';


let MAX_NAME_LENGTH = 140;
let MAX_DESCRIPTION_LENGTH = 2000;
let MAX_IMAGE_URL_LENGTH = 2048;
let MAX_PRICE = 1000000000;
let MAX_QUANTITY = 1000000000;

function CatalogServiceError(code, message, statusCode, details) {
  this.name = 'CatalogServiceError';
  this.code = code || 'catalog-error';
  this.statusCode = Number.isFinite(statusCode) ? statusCode : 400;
  this.message = message || 'Catalog service error';
  this.details = details || null;
  Error.captureStackTrace(this, CatalogServiceError);
}

CatalogServiceError.prototype = Object.create(Error.prototype);
CatalogServiceError.prototype.constructor = CatalogServiceError;

function toTrimmedString(value) {
  if (value === null || typeof value === 'undefined') {
    return '';
  }

  return String(value).trim();
}

function normalizeName(value) {
  return toTrimmedString(value).toLowerCase().replace(/\s+/g, ' ');
}

function slugify(value) {
  return toTrimmedString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function sanitizeName(value, fieldName) {
  let cleanedValue = toTrimmedString(value);

  if (!cleanedValue) {
    throw new CatalogServiceError('validation-error', fieldName + ' is required', 400);
  }

  if (cleanedValue.length > MAX_NAME_LENGTH) {
    throw new CatalogServiceError('validation-error', fieldName + ' is too long', 400);
  }

  return cleanedValue;
}

function sanitizeOptionalText(value, maxLength) {
  let cleanedValue = toTrimmedString(value);
  if (!cleanedValue) {
    return '';
  }

  if (cleanedValue.length > maxLength) {
    throw new CatalogServiceError('validation-error', 'Text value is too long', 400);
  }

  return cleanedValue;
}

function sanitizeImageUrl(value) {
  let cleanedValue = toTrimmedString(value);

  if (!cleanedValue) {
    return '';
  }

  if (cleanedValue.length > MAX_IMAGE_URL_LENGTH) {
    throw new CatalogServiceError('validation-error', 'Image URL is too long', 400);
  }

  if (/^https?:\/\//i.test(cleanedValue)) {
    return cleanedValue;
  }

  if (cleanedValue.charAt(0) === '/') {
    return cleanedValue;
  }

  throw new CatalogServiceError('validation-error', 'Image URL must be absolute HTTP(S) URL or an app-relative path', 400);
}

function parseNonNegativeNumber(value, fieldName, required) {
  let cleanedValue = toTrimmedString(value);
  let parsedValue = null;

  if (!cleanedValue) {
    if (required) {
      throw new CatalogServiceError('validation-error', fieldName + ' is required', 400);
    }
    return null;
  }

  parsedValue = Number(cleanedValue.replace(/,/g, ''));
  if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > MAX_PRICE) {
    throw new CatalogServiceError('validation-error', fieldName + ' must be a non-negative number', 400);
  }

  return Math.round(parsedValue * 100) / 100;
}

function parseQuantity(value, required) {
  let cleanedValue = toTrimmedString(value);
  let parsedValue = null;

  if (!cleanedValue) {
    if (required) {
      throw new CatalogServiceError('validation-error', 'quantity is required', 400);
    }
    return null;
  }

  parsedValue = Number(cleanedValue.replace(/,/g, ''));
  if (!Number.isFinite(parsedValue) || parsedValue < 0 || parsedValue > MAX_QUANTITY) {
    throw new CatalogServiceError('validation-error', 'quantity must be a non-negative integer', 400);
  }

  return Math.floor(parsedValue);
}

function parseStockDelta(value) {
  let cleanedValue = toTrimmedString(value);
  let parsedValue = null;

  if (!cleanedValue) {
    return null;
  }

  parsedValue = Number(cleanedValue);
  if (!Number.isFinite(parsedValue) || Math.floor(parsedValue) !== parsedValue) {
    throw new CatalogServiceError('validation-error', 'stockDelta must be an integer', 400);
  }

  if (Math.abs(parsedValue) > MAX_QUANTITY) {
    throw new CatalogServiceError('validation-error', 'stockDelta is out of range', 400);
  }

  return parsedValue;
}

function sanitizeKeywordList(value) {
  let rawList = [];
  let seen = Object.create(null);

  if (Array.isArray(value)) {
    rawList = value;
  } else if (typeof value === 'string' && value.trim()) {
    rawList = value.split(',');
  } else {
    return [];
  }

  return rawList
    .map(function (entry) {
      return normalizeName(entry).replace(/[^a-z0-9\s-]/g, '');
    })
    .filter(function (entry) {
      if (!entry || seen[entry]) {
        return false;
      }
      seen[entry] = true;
      return true;
    })
    .slice(0, 40);
}

function ensureObjectId(value, fieldName) {
  let cleanedValue = toTrimmedString(value);

  if (!cleanedValue || !mongoose.isValidObjectId(cleanedValue)) {
    throw new CatalogServiceError('validation-error', fieldName + ' must be a valid ObjectId', 400);
  }

  return new mongoose.Types.ObjectId(cleanedValue);
}

function parseBoolean(value, fieldName) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    let normalizedValue = value.trim().toLowerCase();
    if (normalizedValue === 'true' || normalizedValue === '1') {
      return true;
    }
    if (normalizedValue === 'false' || normalizedValue === '0') {
      return false;
    }
  }

  throw new CatalogServiceError('validation-error', fieldName + ' must be a boolean', 400);
}

function isDuplicateKeyError(error) {
  return Boolean(error) && Number(error.code) === 11000;
}

function toPublicCategory(categoryDoc) {
  return {
    id: String(categoryDoc._id),
    name: categoryDoc.name,
    slug: categoryDoc.slug,
    description: categoryDoc.description,
    isActive: Boolean(categoryDoc.isActive),
    createdAt: categoryDoc.createdAt,
    updatedAt: categoryDoc.updatedAt,
  };
}

function toPublicBrand(brandDoc) {
  return {
    id: String(brandDoc._id),
    categoryId: String(brandDoc.category),
    name: brandDoc.name,
    slug: brandDoc.slug,
    description: brandDoc.description,
    isActive: Boolean(brandDoc.isActive),
    createdAt: brandDoc.createdAt,
    updatedAt: brandDoc.updatedAt,
  };
}

function toPublicProduct(productDoc) {
  return {
    id: String(productDoc._id),
    legacyId: productDoc.legacyId || '',
    categoryId: String(productDoc.category),
    brandId: String(productDoc.brand),
    sku: productDoc.sku || '',
    name: productDoc.name,
    slug: productDoc.slug,
    description: productDoc.description || '',
    spec: productDoc.spec || '',
    price: productDoc.price,
    compareAtPrice: typeof productDoc.compareAtPrice === 'number' ? productDoc.compareAtPrice : null,
    // compute discount percent from compareAtPrice (actual) and price (final)
    discountPercent: (function () {
      var cap = typeof productDoc.compareAtPrice === 'number' ? productDoc.compareAtPrice : null;
      var p = typeof productDoc.price === 'number' ? productDoc.price : Number(productDoc.price) || 0;
      if (cap !== null && Number.isFinite(cap) && cap > 0 && cap > p) {
        return Math.round(((cap - p) / cap) * 10000) / 100;
      }
      return 0;
    })(),
    quantity: productDoc.quantity,
    imageUrl: productDoc.imageUrl || '',
    searchKeywords: Array.isArray(productDoc.searchKeywords) ? productDoc.searchKeywords : [],
    status: productDoc.status,
    isActive: Boolean(productDoc.isActive),
    createdAt: productDoc.createdAt,
    updatedAt: productDoc.updatedAt,
  };
}

async function ensureDatabaseConnection() {
  let connected = await database.connectToDatabase();
  if (!connected) {
    throw new CatalogServiceError('db-unavailable', 'Database unavailable', 503);
  }
}

async function resolveCategoryReference(input) {
  let categoryId = toTrimmedString(input.categoryId);
  let categoryName = toTrimmedString(input.categoryName);
  let categoryDoc = null;

  if (categoryId) {
    categoryDoc = await Category.findById(ensureObjectId(categoryId, 'categoryId')).lean();
    if (!categoryDoc) {
      throw new CatalogServiceError('category-not-found', 'Category not found', 404);
    }
    return categoryDoc;
  }

  if (categoryName) {
    return createCategory({
      name: categoryName,
      description: input.categoryDescription,
    }).then(function (result) {
      return Category.findById(result.category.id).lean();
    });
  }

  throw new CatalogServiceError('validation-error', 'categoryId or categoryName is required', 400);
}

async function resolveBrandReference(input, categoryDoc) {
  let brandId = toTrimmedString(input.brandId);
  let brandName = toTrimmedString(input.brandName);
  let brandDoc = null;

  if (brandId) {
    brandDoc = await Brand.findById(ensureObjectId(brandId, 'brandId')).lean();
    if (!brandDoc) {
      throw new CatalogServiceError('brand-not-found', 'Brand not found', 404);
    }

    if (String(brandDoc.category) !== String(categoryDoc._id)) {
      throw new CatalogServiceError('validation-error', 'Brand does not belong to the selected category', 400);
    }

    return brandDoc;
  }

  if (brandName) {
    return createBrand({
      categoryId: String(categoryDoc._id),
      name: brandName,
      description: input.brandDescription,
    }).then(function (result) {
      return Brand.findById(result.brand.id).lean();
    });
  }

  throw new CatalogServiceError('validation-error', 'brandId or brandName is required', 400);
}

async function createCategory(input) {
  let name = sanitizeName(input && input.name, 'name');
  let description = sanitizeOptionalText(input && input.description, 500);
  let normalizedName = normalizeName(name);
  let writeResult = null;
  let categoryDoc = null;

  await ensureDatabaseConnection();

  try {
    writeResult = await Category.updateOne(
      { normalizedName: normalizedName },
      {
        $setOnInsert: {
          name: name,
          normalizedName: normalizedName,
          slug: slugify(name),
          description: description,
          isActive: true,
        },
      },
      {
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new CatalogServiceError('duplicate-category', 'Category already exists', 409);
    }
    throw error;
  }

  categoryDoc = await Category.findOne({ normalizedName: normalizedName }).lean();
  return {
    created: Boolean(writeResult && writeResult.upsertedCount > 0),
    category: toPublicCategory(categoryDoc),
  };
}

async function createBrand(input) {
  let categoryDoc = null;
  let name = sanitizeName(input && input.name, 'name');
  let description = sanitizeOptionalText(input && input.description, 500);
  let normalizedName = normalizeName(name);
  let writeResult = null;
  let brandDoc = null;

  await ensureDatabaseConnection();
  categoryDoc = await resolveCategoryReference(input || {});

  try {
    writeResult = await Brand.updateOne(
      {
        category: categoryDoc._id,
        normalizedName: normalizedName,
      },
      {
        $setOnInsert: {
          category: categoryDoc._id,
          name: name,
          normalizedName: normalizedName,
          slug: slugify(name),
          description: description,
          isActive: true,
        },
      },
      {
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new CatalogServiceError('duplicate-brand', 'Brand already exists in this category', 409);
    }
    throw error;
  }

  brandDoc = await Brand.findOne({
    category: categoryDoc._id,
    normalizedName: normalizedName,
  }).lean();

  return {
    created: Boolean(writeResult && writeResult.upsertedCount > 0),
    brand: toPublicBrand(brandDoc),
    category: toPublicCategory(categoryDoc),
  };
}

async function createProduct(input) {
  let productInput = input && typeof input === 'object' ? input : {};
  let categoryDoc = null;
  let brandDoc = null;
  let name = sanitizeName(productInput.name, 'name');
  let normalizedName = normalizeName(name);
  let description = sanitizeOptionalText(productInput.description, MAX_DESCRIPTION_LENGTH);
  let spec = sanitizeOptionalText(productInput.spec, MAX_DESCRIPTION_LENGTH);
  let price = parseNonNegativeNumber(productInput.price, 'price', true);
  let compareAtPrice = parseNonNegativeNumber(productInput.compareAtPrice, 'compareAtPrice', false);
  let quantity = parseQuantity(productInput.quantity, true);
  let imageUrl = sanitizeImageUrl(productInput.imageUrl);
  let searchKeywords = sanitizeKeywordList(productInput.searchKeywords);
  let sku = toTrimmedString(productInput.sku).toUpperCase();
  let legacyId = toTrimmedString(productInput.legacyId);
  let writeResult = null;
  let productDoc = null;

  if (compareAtPrice !== null && compareAtPrice < price) {
    throw new CatalogServiceError('validation-error', 'compareAtPrice cannot be lower than price', 400);
  }

  await ensureDatabaseConnection();
  categoryDoc = await resolveCategoryReference(productInput);
  brandDoc = await resolveBrandReference(productInput, categoryDoc);

  try {
    writeResult = await Product.updateOne(
      {
        category: categoryDoc._id,
        normalizedName: normalizedName,
      },
      {
        $setOnInsert: {
          category: categoryDoc._id,
          brand: brandDoc._id,
          legacyId: legacyId || undefined,
          sku: sku || undefined,
          name: name,
          normalizedName: normalizedName,
          slug: slugify(name),
          description: description,
          spec: spec,
          price: price,
          compareAtPrice: compareAtPrice,
          quantity: quantity,
          imageUrl: imageUrl,
          searchKeywords: searchKeywords,
          status: 'active',
          isActive: true,
        },
      },
      {
        upsert: true,
        runValidators: true,
        setDefaultsOnInsert: true,
      }
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new CatalogServiceError('duplicate-product', 'Product already exists for this category', 409);
    }
    throw error;
  }

  if (!writeResult || writeResult.upsertedCount === 0) {
    throw new CatalogServiceError('duplicate-product', 'Product already exists for this category', 409);
  }

  productDoc = await Product.findOne({
    category: categoryDoc._id,
    normalizedName: normalizedName,
  }).lean();

  return {
    created: true,
    product: toPublicProduct(productDoc),
  };
}

function buildProductSetPayload(payload) {
  let setPayload = {};
  let unsetPayload = {};
  let hasAnyChanges = false;
  let hasQuantity = false;
  let hasStockDelta = false;
  let stockDelta = parseStockDelta(payload.stockDelta);
  let quantity = parseQuantity(payload.quantity, false);
  let price = parseNonNegativeNumber(payload.price, 'price', false);
  let compareAtPrice = parseNonNegativeNumber(payload.compareAtPrice, 'compareAtPrice', false);
  let imageUrl = payload.imageUrl === null ? '' : sanitizeImageUrl(payload.imageUrl);
  let sku = toTrimmedString(payload.sku).toUpperCase();

  if (toTrimmedString(payload.name)) {
    let cleanName = sanitizeName(payload.name, 'name');
    setPayload.name = cleanName;
    setPayload.normalizedName = normalizeName(cleanName);
    setPayload.slug = slugify(cleanName);
    hasAnyChanges = true;
  }

  if (typeof payload.description !== 'undefined') {
    setPayload.description = sanitizeOptionalText(payload.description, MAX_DESCRIPTION_LENGTH);
    hasAnyChanges = true;
  }

  if (typeof payload.spec !== 'undefined') {
    setPayload.spec = sanitizeOptionalText(payload.spec, MAX_DESCRIPTION_LENGTH);
    hasAnyChanges = true;
  }

  if (price !== null) {
    setPayload.price = price;
    hasAnyChanges = true;
  }

  if (typeof payload.compareAtPrice !== 'undefined') {
    setPayload.compareAtPrice = compareAtPrice;
    hasAnyChanges = true;
  }

  if (quantity !== null) {
    setPayload.quantity = quantity;
    hasAnyChanges = true;
    hasQuantity = true;
  }

  if (stockDelta !== null) {
    hasStockDelta = true;
  }

  if (typeof payload.imageUrl !== 'undefined') {
    setPayload.imageUrl = imageUrl;
    hasAnyChanges = true;
  }

  if (typeof payload.status !== 'undefined') {
    let status = toTrimmedString(payload.status).toLowerCase();
    if (status !== 'active' && status !== 'inactive') {
      throw new CatalogServiceError('validation-error', 'status must be active or inactive', 400);
    }
    setPayload.status = status;
    hasAnyChanges = true;
  }

  if (typeof payload.isActive !== 'undefined') {
    setPayload.isActive = parseBoolean(payload.isActive, 'isActive');
    hasAnyChanges = true;
  }

  if (typeof payload.searchKeywords !== 'undefined') {
    setPayload.searchKeywords = sanitizeKeywordList(payload.searchKeywords);
    hasAnyChanges = true;
  }

  if (typeof payload.sku !== 'undefined') {
    if (sku) {
      setPayload.sku = sku;
    } else {
      unsetPayload.sku = 1;
    }
    hasAnyChanges = true;
  }

  if (hasQuantity && hasStockDelta) {
    throw new CatalogServiceError('validation-error', 'Provide either quantity or stockDelta, not both', 400);
  }

  if (setPayload.price !== undefined && setPayload.compareAtPrice !== undefined && setPayload.compareAtPrice !== null && setPayload.compareAtPrice < setPayload.price) {
    throw new CatalogServiceError('validation-error', 'compareAtPrice cannot be lower than price', 400);
  }

  return {
    hasAnyChanges: hasAnyChanges || hasStockDelta,
    setPayload: setPayload,
    unsetPayload: unsetPayload,
    stockDelta: stockDelta,
  };
}

async function updateProduct(productId, payload) {
  let productObjectId = ensureObjectId(productId, 'productId');
  let existingProduct = null;
  let nextCategory = null;
  let nextBrand = null;
  let updatePlan = null;
  let filter = { _id: productObjectId };
  let updateDoc = {};
  let updatedProduct = null;
  let shouldApplyCategoryChange = false;
  let shouldApplyBrandChange = false;

  await ensureDatabaseConnection();

  existingProduct = await Product.findById(productObjectId).lean();
  if (!existingProduct) {
    throw new CatalogServiceError('product-not-found', 'Product not found', 404);
  }

  nextCategory = await Category.findById(existingProduct.category).lean();
  nextBrand = await Brand.findById(existingProduct.brand).lean();

  if (!nextCategory || !nextBrand) {
    throw new CatalogServiceError('integrity-error', 'Product has invalid category or brand reference', 409);
  }

  if (toTrimmedString(payload.categoryId) || toTrimmedString(payload.categoryName)) {
    nextCategory = await resolveCategoryReference(payload || {});
    shouldApplyCategoryChange = String(nextCategory._id) !== String(existingProduct.category);
  }

  if (toTrimmedString(payload.brandId) || toTrimmedString(payload.brandName)) {
    nextBrand = await resolveBrandReference(payload || {}, nextCategory);
    shouldApplyBrandChange = String(nextBrand._id) !== String(existingProduct.brand);
  } else if (shouldApplyCategoryChange) {
    throw new CatalogServiceError('validation-error', 'brandId or brandName is required when category changes', 400);
  }

  updatePlan = buildProductSetPayload(payload || {});
  if (!updatePlan.hasAnyChanges && !shouldApplyCategoryChange && !shouldApplyBrandChange) {
    throw new CatalogServiceError('validation-error', 'No valid fields were provided for update', 400);
  }

  if (shouldApplyCategoryChange) {
    updatePlan.setPayload.category = nextCategory._id;
  }

  if (shouldApplyBrandChange) {
    updatePlan.setPayload.brand = nextBrand._id;
  }

  if (Object.keys(updatePlan.setPayload).length > 0) {
    updateDoc.$set = updatePlan.setPayload;
  }

  if (Object.keys(updatePlan.unsetPayload).length > 0) {
    updateDoc.$unset = updatePlan.unsetPayload;
  }

  if (
    updatePlan.setPayload.compareAtPrice !== undefined &&
    updatePlan.setPayload.compareAtPrice !== null
  ) {
    let comparePriceCheckValue = Number.isFinite(updatePlan.setPayload.price)
      ? updatePlan.setPayload.price
      : existingProduct.price;

    if (updatePlan.setPayload.compareAtPrice < comparePriceCheckValue) {
      throw new CatalogServiceError('validation-error', 'compareAtPrice cannot be lower than price', 400);
    }
  }

  if (updatePlan.stockDelta !== null) {
    updateDoc.$inc = { quantity: updatePlan.stockDelta };
    if (updatePlan.stockDelta < 0) {
      filter.quantity = mongoose.trusted({ $gte: Math.abs(updatePlan.stockDelta) });
    }
  }

  let targetCategoryId = shouldApplyCategoryChange ? nextCategory._id : existingProduct.category;
  let targetNormalizedName = updatePlan.setPayload.normalizedName || existingProduct.normalizedName;
  let dupQuery = {
    category: targetCategoryId,
    normalizedName: targetNormalizedName,
  };
  console.debug('catalogCrudService duplicateProduct lookup:', dupQuery, 'excludeId:', productObjectId);
  let duplicateProduct = await Product.findOne(dupQuery).select('_id').lean();

  if (duplicateProduct && String(duplicateProduct._id) !== String(productObjectId)) {
    throw new CatalogServiceError('duplicate-product', 'Product name already exists in this category', 409);
  }

  try {
    updatedProduct = await Product.findOneAndUpdate(
      filter,
      updateDoc,
      {
        lean: true,
        returnDocument: 'after',
        runValidators: true,
        context: 'query',
      }
    );
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new CatalogServiceError('duplicate-product', 'Product name already exists in this category', 409);
    }
    throw error;
  }

  if (!updatedProduct) {
    if (updatePlan.stockDelta !== null && updatePlan.stockDelta < 0) {
      throw new CatalogServiceError('insufficient-stock', 'Not enough stock to apply the requested update', 409);
    }
    throw new CatalogServiceError('product-not-found', 'Product not found', 404);
  }

  return {
    updated: true,
    product: toPublicProduct(updatedProduct),
  };
}

async function deleteProduct(productId) {
  let productObjectId = ensureObjectId(productId, 'productId');
  let deletedProduct = null;

  await ensureDatabaseConnection();

  deletedProduct = await Product.findOneAndDelete({ _id: productObjectId }).lean();
  if (!deletedProduct) {
    throw new CatalogServiceError('product-not-found', 'Product not found', 404);
  }

  return {
    deleted: true,
    product: toPublicProduct(deletedProduct),
  };
}
export default {
  CatalogServiceError: CatalogServiceError,
  createBrand: createBrand,
  createCategory: createCategory,
  createProduct: createProduct,
  deleteProduct: deleteProduct,
  updateProduct: updateProduct,
};
