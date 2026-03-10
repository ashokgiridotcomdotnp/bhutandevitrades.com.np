var { body, param, validationResult } = require('express-validator');

// Helper to handle validation errors
function handleValidationErrors(req, res, next) {
    var errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            errors: errors.array().map(function (err) {
                return {
                    field: err.path,
                    message: err.msg,
                };
            }),
        });
    }
    next();
}

// Sanitize string input
function sanitizeString(value) {
    if (typeof value !== 'string') return '';
    return value
        .trim()
        .replace(/[<>]/g, '') // Basic XSS prevention
        .slice(0, 1000); // Max length
}

function hasAtLeastOneField(value, fields) {
    return fields.some(function (field) {
        return typeof value[field] !== 'undefined';
    });
}

// Validation rules
var validators = {
    // Auth validations
    signup: [
        body('name')
            .trim()
            .isLength({ min: 2, max: 120 })
            .withMessage('Name must be between 2 and 120 characters')
            .matches(/^[a-zA-Z\s'-]+$/)
            .withMessage('Name contains invalid characters')
            .customSanitizer(sanitizeString),
        body('email')
            .isEmail()
            .withMessage('Please provide a valid email')
            .normalizeEmail()
            .isLength({ max: 254 })
            .withMessage('Email is too long'),
        body('password')
            .isLength({ min: 6, max: 128 })
            .withMessage('Password must be between 6 and 128 characters'),
        handleValidationErrors,
    ],

    login: [
        body('email')
            .isEmail()
            .withMessage('Please provide a valid email')
            .normalizeEmail()
            .isLength({ max: 254 }),
        body('password')
            .isLength({ min: 1, max: 128 })
            .withMessage('Password is required'),
        handleValidationErrors,
    ],

    forgotPassword: [
        body('email')
            .isEmail()
            .withMessage('Please provide a valid email')
            .normalizeEmail()
            .isLength({ max: 254 }),
        handleValidationErrors,
    ],

    // Order validations
    orderSubmit: [
        body('customerName')
            .optional()
            .trim()
            .isLength({ max: 120 })
            .withMessage('Name is too long')
            .customSanitizer(sanitizeString),
        body('phoneNumber')
            .trim()
            .matches(/^[0-9+\-\s()]+$/)
            .withMessage('Invalid phone number format')
            .isLength({ min: 8, max: 20 })
            .withMessage('Phone number must be between 8 and 20 characters'),
        body('quantity')
            .isInt({ min: 1, max: 999 })
            .withMessage('Quantity must be between 1 and 999'),
        body('note')
            .optional()
            .trim()
            .isLength({ max: 500 })
            .withMessage('Note is too long (max 500 characters)')
            .customSanitizer(sanitizeString),
        handleValidationErrors,
    ],

    // Profile validations
    updateProfileName: [
        body('name')
            .trim()
            .isLength({ min: 2, max: 120 })
            .withMessage('Name must be between 2 and 120 characters')
            .matches(/^[a-zA-Z\s'-]+$/)
            .withMessage('Name contains invalid characters')
            .customSanitizer(sanitizeString),
        handleValidationErrors,
    ],

    updateProfilePassword: [
        body('currentPassword')
            .isLength({ min: 1, max: 128 })
            .withMessage('Current password is required'),
        body('newPassword')
            .isLength({ min: 6, max: 128 })
            .withMessage('New password must be between 6 and 128 characters'),
        body('confirmPassword')
            .custom(function (value, { req }) {
                return value === req.body.newPassword;
            })
            .withMessage('Passwords do not match'),
        handleValidationErrors,
    ],

    // Admin validations
    adminProduct: [
        body('productName')
            .trim()
            .isLength({ min: 1, max: 120 })
            .withMessage('Product name must be between 1 and 120 characters')
            .customSanitizer(sanitizeString),
        body('productCategory')
            .trim()
            .isLength({ min: 1, max: 80 })
            .withMessage('Category name must be between 1 and 80 characters')
            .customSanitizer(sanitizeString),
        body('productPrice')
            .trim()
            .matches(/^[0-9]+(\.[0-9]{1,2})?$/)
            .withMessage('Price must be a valid number (e.g., 1500 or 1500.50)'),
        body('productSpec')
            .optional()
            .trim()
            .isLength({ max: 600 })
            .withMessage('Specification is too long (max 600 characters)')
            .customSanitizer(sanitizeString),
        handleValidationErrors,
    ],

    adminCategory: [
        body('originalCategoryName')
            .optional({ checkFalsy: true })
            .trim()
            .isLength({ min: 1, max: 80 })
            .withMessage('Original category name must be between 1 and 80 characters')
            .customSanitizer(sanitizeString),
        body('categoryName')
            .trim()
            .isLength({ min: 1, max: 80 })
            .withMessage('Category name must be between 1 and 80 characters')
            .customSanitizer(sanitizeString),
        body('categoryDescription')
            .optional()
            .trim()
            .isLength({ max: 240 })
            .withMessage('Description is too long (max 240 characters)')
            .customSanitizer(sanitizeString),
        handleValidationErrors,
    ],

    // Param validations
    productId: [
        param('productId')
            .matches(/^[a-zA-Z0-9-_]+$/)
            .withMessage('Invalid product ID format')
            .isLength({ max: 100 }),
        handleValidationErrors,
    ],

    // Admin password update
    adminUpdatePassword: [
        body('currentPassword')
            .isLength({ min: 1, max: 128 })
            .withMessage('Current password is required'),
        body('newPassword')
            .isLength({ min: 8, max: 128 })
            .withMessage('New password must be at least 8 characters')
            .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
            .withMessage('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
        body('confirmPassword')
            .custom(function (value, { req }) {
                return value === req.body.newPassword;
            })
            .withMessage('Passwords do not match'),
        handleValidationErrors,
    ],

    // Catalog API validations
    catalogCreateCategory: [
        body('name')
            .trim()
            .isLength({ min: 1, max: 80 })
            .withMessage('Category name must be between 1 and 80 characters')
            .customSanitizer(sanitizeString),
        body('description')
            .optional({ checkFalsy: true })
            .trim()
            .isLength({ max: 500 })
            .withMessage('Category description cannot exceed 500 characters')
            .customSanitizer(sanitizeString),
        handleValidationErrors,
    ],

    catalogCreateBrand: [
        body('categoryId')
            .optional({ checkFalsy: true })
            .isMongoId()
            .withMessage('categoryId must be a valid ObjectId'),
        body('categoryName')
            .optional({ checkFalsy: true })
            .trim()
            .isLength({ min: 1, max: 80 })
            .withMessage('categoryName must be between 1 and 80 characters')
            .customSanitizer(sanitizeString),
        body('name')
            .trim()
            .isLength({ min: 1, max: 80 })
            .withMessage('Brand name must be between 1 and 80 characters')
            .customSanitizer(sanitizeString),
        body('description')
            .optional({ checkFalsy: true })
            .trim()
            .isLength({ max: 500 })
            .withMessage('Brand description cannot exceed 500 characters')
            .customSanitizer(sanitizeString),
        body()
            .custom(function (value) {
                return Boolean(
                    (value && typeof value.categoryId === 'string' && value.categoryId.trim()) ||
                    (value && typeof value.categoryName === 'string' && value.categoryName.trim())
                );
            })
            .withMessage('Either categoryId or categoryName is required'),
        handleValidationErrors,
    ],

    catalogCreateProduct: [
        body('categoryId')
            .optional({ checkFalsy: true })
            .isMongoId()
            .withMessage('categoryId must be a valid ObjectId'),
        body('categoryName')
            .optional({ checkFalsy: true })
            .trim()
            .isLength({ min: 1, max: 80 })
            .withMessage('categoryName must be between 1 and 80 characters')
            .customSanitizer(sanitizeString),
        body('brandId')
            .optional({ checkFalsy: true })
            .isMongoId()
            .withMessage('brandId must be a valid ObjectId'),
        body('brandName')
            .optional({ checkFalsy: true })
            .trim()
            .isLength({ min: 1, max: 80 })
            .withMessage('brandName must be between 1 and 80 characters')
            .customSanitizer(sanitizeString),
        body('name')
            .trim()
            .isLength({ min: 1, max: 140 })
            .withMessage('Product name must be between 1 and 140 characters')
            .customSanitizer(sanitizeString),
        body('price')
            .isFloat({ min: 0, max: 1000000000 })
            .withMessage('price must be a non-negative number'),
        body('compareAtPrice')
            .optional({ checkFalsy: true })
            .isFloat({ min: 0, max: 1000000000 })
            .withMessage('compareAtPrice must be a non-negative number'),
        body('quantity')
            .isInt({ min: 0, max: 1000000000 })
            .withMessage('quantity must be a non-negative integer'),
        body('description')
            .optional({ checkFalsy: true })
            .trim()
            .isLength({ max: 2000 })
            .withMessage('description cannot exceed 2000 characters')
            .customSanitizer(sanitizeString),
        body('spec')
            .optional({ checkFalsy: true })
            .trim()
            .isLength({ max: 2000 })
            .withMessage('spec cannot exceed 2000 characters')
            .customSanitizer(sanitizeString),
        body('imageUrl')
            .optional({ checkFalsy: true })
            .trim()
            .isLength({ max: 2048 })
            .withMessage('imageUrl cannot exceed 2048 characters'),
        body('searchKeywords')
            .optional()
            .custom(function (value) {
                return Array.isArray(value) || typeof value === 'string';
            })
            .withMessage('searchKeywords must be an array or comma separated string'),
        body()
            .custom(function (value) {
                return Boolean(
                    (value && typeof value.categoryId === 'string' && value.categoryId.trim()) ||
                    (value && typeof value.categoryName === 'string' && value.categoryName.trim())
                );
            })
            .withMessage('Either categoryId or categoryName is required'),
        body()
            .custom(function (value) {
                return Boolean(
                    (value && typeof value.brandId === 'string' && value.brandId.trim()) ||
                    (value && typeof value.brandName === 'string' && value.brandName.trim())
                );
            })
            .withMessage('Either brandId or brandName is required'),
        handleValidationErrors,
    ],

    catalogUpdateProduct: [
        param('productId')
            .isMongoId()
            .withMessage('productId must be a valid ObjectId'),
        body('categoryId')
            .optional({ checkFalsy: true })
            .isMongoId()
            .withMessage('categoryId must be a valid ObjectId'),
        body('brandId')
            .optional({ checkFalsy: true })
            .isMongoId()
            .withMessage('brandId must be a valid ObjectId'),
        body('name')
            .optional({ checkFalsy: true })
            .trim()
            .isLength({ min: 1, max: 140 })
            .withMessage('name must be between 1 and 140 characters')
            .customSanitizer(sanitizeString),
        body('price')
            .optional({ checkFalsy: true })
            .isFloat({ min: 0, max: 1000000000 })
            .withMessage('price must be a non-negative number'),
        body('compareAtPrice')
            .optional({ checkFalsy: true })
            .isFloat({ min: 0, max: 1000000000 })
            .withMessage('compareAtPrice must be a non-negative number'),
        body('quantity')
            .optional({ checkFalsy: true })
            .isInt({ min: 0, max: 1000000000 })
            .withMessage('quantity must be a non-negative integer'),
        body('stockDelta')
            .optional({ checkFalsy: true })
            .isInt({ min: -1000000000, max: 1000000000 })
            .withMessage('stockDelta must be an integer'),
        body('description')
            .optional()
            .trim()
            .isLength({ max: 2000 })
            .withMessage('description cannot exceed 2000 characters')
            .customSanitizer(sanitizeString),
        body('spec')
            .optional()
            .trim()
            .isLength({ max: 2000 })
            .withMessage('spec cannot exceed 2000 characters')
            .customSanitizer(sanitizeString),
        body('imageUrl')
            .optional({ nullable: true })
            .isLength({ max: 2048 })
            .withMessage('imageUrl cannot exceed 2048 characters'),
        body('status')
            .optional({ checkFalsy: true })
            .isIn(['active', 'inactive'])
            .withMessage('status must be active or inactive'),
        body()
            .custom(function (value) {
                return hasAtLeastOneField(value || {}, [
                    'categoryId',
                    'categoryName',
                    'brandId',
                    'brandName',
                    'name',
                    'description',
                    'spec',
                    'price',
                    'compareAtPrice',
                    'quantity',
                    'stockDelta',
                    'imageUrl',
                    'status',
                    'isActive',
                    'searchKeywords',
                    'sku',
                ]);
            })
            .withMessage('At least one updatable field is required'),
        body()
            .custom(function (value) {
                return !(typeof value.quantity !== 'undefined' && typeof value.stockDelta !== 'undefined');
            })
            .withMessage('Provide either quantity or stockDelta, not both'),
        handleValidationErrors,
    ],

    catalogDeleteProduct: [
        param('productId')
            .isMongoId()
            .withMessage('productId must be a valid ObjectId'),
        handleValidationErrors,
    ],
};

module.exports = validators;
