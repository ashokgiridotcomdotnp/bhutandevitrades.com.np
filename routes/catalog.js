var express = require('express');
var validators = require('../lib/validation');
var catalogController = require('../controllers/catalogController');
var requestSanitizer = require('../lib/requestSanitizer');

var router = express.Router();

router.use(requestSanitizer.sanitizeRequestPayload);

router.post('/categories', validators.catalogCreateCategory, catalogController.createCategory);
router.post('/brands', validators.catalogCreateBrand, catalogController.createBrand);
router.post('/products', validators.catalogCreateProduct, catalogController.createProduct);
router.patch('/products/:productId', validators.catalogUpdateProduct, catalogController.updateProduct);
router.delete('/products/:productId', validators.catalogDeleteProduct, catalogController.deleteProduct);

module.exports = router;
