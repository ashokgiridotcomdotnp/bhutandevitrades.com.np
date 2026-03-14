import catalogCrudService from '../services/catalogCrudService.js';

let catalogMutationQueue = Promise.resolve();

function runCatalogMutation(task) {
  let queuedTask = catalogMutationQueue.then(function () {
    return Promise.resolve().then(task);
  });

  catalogMutationQueue = queuedTask.catch(function () {
    return undefined;
  });

  return queuedTask;
}

function sendSuccess(res, statusCode, payload) {
  return res.status(statusCode).json({
    success: true,
    data: payload,
  });
}

function sendError(res, error) {
  let statusCode = error && Number.isFinite(error.statusCode) ? error.statusCode : 500;
  let code = error && error.code ? error.code : 'internal-error';
  let message = error && error.message ? error.message : 'Unexpected catalog error';

  if (statusCode >= 500) {
    console.error('Catalog controller error:', message);
  }

  return res.status(statusCode).json({
    success: false,
    error: {
      code: code,
      message: message,
      details: error && error.details ? error.details : null,
    },
  });
}

async function createCategory(req, res) {
  try {
    let result = await runCatalogMutation(function () {
      return catalogCrudService.createCategory(req.body || {});
    });
    return sendSuccess(res, result.created ? 201 : 200, result);
  } catch (error) {
    return sendError(res, error);
  }
}

async function createBrand(req, res) {
  try {
    let result = await runCatalogMutation(function () {
      return catalogCrudService.createBrand(req.body || {});
    });
    return sendSuccess(res, result.created ? 201 : 200, result);
  } catch (error) {
    return sendError(res, error);
  }
}

async function createProduct(req, res) {
  try {
    let result = await runCatalogMutation(function () {
      return catalogCrudService.createProduct(req.body || {});
    });
    return sendSuccess(res, 201, result);
  } catch (error) {
    return sendError(res, error);
  }
}

async function updateProduct(req, res) {
  try {
    let result = await runCatalogMutation(function () {
      return catalogCrudService.updateProduct(req.params.productId, req.body || {});
    });
    return sendSuccess(res, 200, result);
  } catch (error) {
    return sendError(res, error);
  }
}

async function deleteProduct(req, res) {
  try {
    let result = await runCatalogMutation(function () {
      return catalogCrudService.deleteProduct(req.params.productId);
    });
    return sendSuccess(res, 200, result);
  } catch (error) {
    return sendError(res, error);
  }
}
export default {
  createBrand: createBrand,
  createCategory: createCategory,
  createProduct: createProduct,
  deleteProduct: deleteProduct,
  updateProduct: updateProduct,
};
