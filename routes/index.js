import express from 'express';
import adminController from '../controllers/adminController.js';
import authController from '../controllers/authController.js';
import publicController from '../controllers/publicController.js';
import asyncHandler from '../lib/asyncHandler.js';
import userAuth from '../lib/userAuth.js';


let router = express.Router();

router.get(['/', '/home'], asyncHandler(publicController.renderHomePage));
router.post('/orders', asyncHandler(publicController.handleOrderSubmit));
router.get('/order/:productId', asyncHandler(publicController.renderOrderPage));
router.get('/login', publicController.renderLoginPage);
router.post('/login', asyncHandler(publicController.handleLoginSubmit));
router.get('/forgot-password', publicController.renderForgotPasswordPage);
router.post('/forgot-password', asyncHandler(publicController.handleForgotPasswordSubmit));
router.get('/my-orders', asyncHandler(publicController.renderMyOrdersPage));
router.get('/profile', userAuth.requireUserAuth, asyncHandler(publicController.renderProfilePage));
router.get('/signup', publicController.renderSignupPage);
router.post('/signup', asyncHandler(publicController.handleSignupSubmit));
router.post('/logout', asyncHandler(publicController.handleUserLogout));
router.post('/profile/name', userAuth.requireUserAuth, asyncHandler(publicController.handleProfileNameUpdate));
router.post('/profile/password', userAuth.requireUserAuth, asyncHandler(publicController.handleProfilePasswordUpdate));
router.get('/admin/login', authController.renderAdminLogin);
router.post('/admin/login', asyncHandler(authController.handleAdminLogin));
router.get('/admin/logout', asyncHandler(authController.handleAdminLogout));
router.post('/admin/logout', asyncHandler(authController.handleAdminLogout));

router.use('/admin', authController.requireAdminAuth);

router.get('/admin', asyncHandler(adminController.renderAdminPage));
router.get('/admin/orders', asyncHandler(adminController.renderAdminOrdersPage));
router.get('/admin/products', asyncHandler(adminController.renderAdminProductsPage));
router.get('/admin/categories', adminController.redirectAdminCategoryRoot);
router.get('/admin/categories/:categorySlug', asyncHandler(adminController.renderAdminCategoryPage));
router.post('/admin/prices', asyncHandler(adminController.saveProductPrice));
router.post('/admin/images', adminController.saveProductImage);
router.post('/admin/products/edit', adminController.editProduct);
router.post('/admin/products/delete', asyncHandler(adminController.deleteProduct));
router.post('/admin/categories/delete', asyncHandler(adminController.deleteCategory));
router.post('/admin/categories', asyncHandler(adminController.saveCategory));
router.post('/admin/products', adminController.saveProduct);
router.get('/admin/orders/accept', function (req, res) {
  return res.redirect('/admin/orders');
});
router.post('/admin/orders/accept', asyncHandler(adminController.acceptOrderRequest));
router.get('/admin/orders/delete', function (req, res) {
  return res.redirect('/admin/orders');
});
router.post('/admin/orders/delete', asyncHandler(adminController.deleteOrderRequest));
router.get('/admin/profile', authController.renderAdminProfile);
router.post('/admin/profile/password', asyncHandler(authController.handleAdminUpdatePassword));

router.get('/products/:productId', asyncHandler(publicController.renderProductDetail));
export default router;
