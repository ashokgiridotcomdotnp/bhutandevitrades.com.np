var express = require('express');
var adminController = require('../controllers/adminController');
var authController = require('../controllers/authController');
var publicController = require('../controllers/publicController');
var userAuth = require('../lib/userAuth');
var validators = require('../lib/validation');

var router = express.Router();

router.use(adminController.refreshAdminDataMiddleware);

router.get(['/', '/home'], publicController.renderHomePage);
router.post('/orders', validators.orderSubmit, publicController.handleOrderSubmit);
router.get('/order/:productId', validators.productId, publicController.renderOrderPage);
router.get('/login', publicController.renderLoginPage);
router.post('/login', validators.login, publicController.handleLoginSubmit);
router.get('/forgot-password', publicController.renderForgotPasswordPage);
router.post('/forgot-password', validators.forgotPassword, publicController.handleForgotPasswordSubmit);
router.get('/my-orders', publicController.renderMyOrdersPage);
router.get('/profile', userAuth.requireUserAuth, publicController.renderProfilePage);
router.get('/signup', publicController.renderSignupPage);
router.post('/signup', validators.signup, publicController.handleSignupSubmit);
router.post('/logout', publicController.handleUserLogout);
router.post('/profile/name', userAuth.requireUserAuth, validators.updateProfileName, publicController.handleProfileNameUpdate);
router.post('/profile/password', userAuth.requireUserAuth, validators.updateProfilePassword, publicController.handleProfilePasswordUpdate);
router.get('/admin/login', authController.renderAdminLogin);
router.post('/admin/login', authController.handleAdminLogin);
router.post('/admin/logout', authController.handleAdminLogout);

router.use('/admin', authController.requireAdminAuth);

router.get('/admin', adminController.renderAdminPage);
router.get('/admin/orders', adminController.renderAdminOrdersPage);
router.get('/admin/categories/:categorySlug', adminController.renderAdminCategoryPage);
router.post('/admin/prices', adminController.saveProductPrice);
router.post('/admin/images', adminController.saveProductImage);
router.post('/admin/products/edit', adminController.editProduct);
router.post('/admin/products/delete', adminController.deleteProduct);
router.post('/admin/categories/delete', adminController.deleteCategory);
router.post('/admin/categories', validators.adminCategory, adminController.saveCategory);
router.post('/admin/products', adminController.saveProduct);
router.get('/admin/orders/accept', function (req, res) {
  return res.redirect('/admin/orders');
});
router.post('/admin/orders/accept', adminController.acceptOrderRequest);
router.get('/admin/orders/delete', function (req, res) {
  return res.redirect('/admin/orders');
});
router.post('/admin/orders/delete', adminController.deleteOrderRequest);
router.get('/admin/profile', authController.renderAdminProfile);
router.post('/admin/profile/password', validators.adminUpdatePassword, authController.handleAdminUpdatePassword);

router.get('/products/:productId', publicController.renderProductDetail);

module.exports = router;
