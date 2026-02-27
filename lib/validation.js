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
};

module.exports = validators;
