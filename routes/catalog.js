import express from 'express';
import validators from '../lib/validation.js';
import catalogController from '../controllers/catalogController.js';
import requestSanitizer from '../lib/requestSanitizer.js';


let router = express.Router();

router.use(requestSanitizer.sanitizeRequestPayload);

router.post('/categories', validators.catalogCreateCategory, catalogController.createCategory);
router.post('/brands', validators.catalogCreateBrand, catalogController.createBrand);
router.post('/products', validators.catalogCreateProduct, catalogController.createProduct);
router.patch('/products/:productId', validators.catalogUpdateProduct, catalogController.updateProduct);
router.delete('/products/:productId', validators.catalogDeleteProduct, catalogController.deleteProduct);
export default router;
