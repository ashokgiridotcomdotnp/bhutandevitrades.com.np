import adminAuth from '../lib/adminAuth.js';
import fs from 'fs';
import path from 'path';

let minAdminPasswordLength = 8;
let maxAdminPasswordLength = 128;
let adminPasswordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]+$/;

function isAjaxRequest(req) {
  let requestedWithHeader = String(req && req.headers ? req.headers['x-requested-with'] || '' : '');
  let acceptHeader = String(req && req.headers ? req.headers.accept || '' : '').toLowerCase();

  return Boolean(
    (req && req.xhr) ||
    requestedWithHeader === 'XMLHttpRequest' ||
    acceptHeader.indexOf('application/json') !== -1
  );
}

function sendPasswordUpdateError(res, isAjax, errorCode, statusCode, message) {
  if (isAjax) {
    return res.status(statusCode).json({ success: false, message: message });
  }

  return res.redirect('/admin/profile?error=' + encodeURIComponent(errorCode));
}

function renderAdminLogin(req, res) {
  let legacyNextPath = adminAuth.getSafeAdminNextPath(req.query.next);
  let legacyErrorCode = String(req.query.error || '').trim();
  let legacyStatusCode = String(req.query.status || '').trim();
  let hasLegacyQueryState = Boolean(legacyNextPath !== '/admin' || legacyErrorCode || legacyStatusCode);
  let loginState = null;
  let nextPath = legacyNextPath;
  let authConfig = adminAuth.getAuthConfig();
  let hasAuthEnabled = authConfig.enabled;
  let hasAuthConfigured = authConfig.configured;
  let errorCode = '';
  let statusCode = '';
  let errorMessage = '';
  let statusMessage = '';

  if (adminAuth.isAuthenticatedRequest(req)) {
    return res.redirect(nextPath);
  }

  if (hasLegacyQueryState) {
    adminAuth.setLoginState(res, req, legacyStatusCode, legacyErrorCode, legacyNextPath);
    return res.redirect('/admin/login');
  }

  loginState = adminAuth.getLoginState(req);
  nextPath = adminAuth.getSafeAdminNextPath(loginState.nextPath || '/admin');
  errorCode = String(loginState.errorCode || '').trim();
  statusCode = String(loginState.statusCode || '').trim();

  if (errorCode || statusCode) {
    adminAuth.clearLoginState(res);
  }

  if (errorCode === 'invalid-credentials') {
    errorMessage = 'Invalid username or password.';
  }

  if (errorCode === 'auth-misconfigured') {
    errorMessage = 'Admin login is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD.';
  }

  if (statusCode === 'logged-out') {
    statusMessage = 'You have been logged out.';
  }

  if (!errorMessage && hasAuthEnabled && !hasAuthConfigured) {
    errorMessage = 'Admin login is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD.';
  }

  return res.render('admin-login', {
    title: 'Admin Login | BhutanDevi Trade and Suppliers',
    nextPath: nextPath,
    hasAuthEnabled: hasAuthEnabled,
    hasAuthConfigured: hasAuthConfigured,
    statusMessage: statusMessage,
    errorMessage: errorMessage,
  });
}

async function handleAdminLogin(req, res) {
  let username = String(req.body.username || '').trim();
  let password = String(req.body.password || '');
  let loginState = adminAuth.getLoginState(req);
  let nextPath = adminAuth.getSafeAdminNextPath(req.body.next || loginState.nextPath);
  let authConfig = adminAuth.getAuthConfig();

  if (!authConfig.enabled) {
    return res.redirect(nextPath);
  }

  if (!authConfig.configured) {
    adminAuth.setLoginState(res, req, '', 'auth-misconfigured', nextPath);
    return res.redirect('/admin/login');
  }

  if (!adminAuth.validateCredentials(username, password)) {
    adminAuth.setLoginState(res, req, '', 'invalid-credentials', nextPath);
    return res.redirect('/admin/login');
  }

  adminAuth.setAuthCookie(res, username);
  adminAuth.clearLoginState(res);
  // Add login success status to show toast notification
  let redirectUrl = new URL(nextPath, 'http://localhost');
  redirectUrl.searchParams.set('status', 'login-success');
  return res.redirect(redirectUrl.pathname + redirectUrl.search);
}

async function handleAdminLogout(req, res) {
  adminAuth.clearAuthCookie(res);
  adminAuth.setLoginState(res, req, 'logged-out', '', '/admin');
  return res.redirect('/admin/login');
}

async function renderAdminProfile(req, res) {
  let authConfig = adminAuth.getAuthConfig();
  let isAjax = isAjaxRequest(req);
  let errorCode = String(req.query.error || '').trim();
  let errorMessage = '';

  if (isAjax) {
    return res.json({
      success: true,
      username: authConfig.username,
    });
  }

  if (errorCode === 'invalid-current-password') {
    errorMessage = 'Current password is incorrect.';
  }

  if (errorCode === 'invalid-new-password') {
    errorMessage = 'New password must be 8-128 characters and include uppercase, lowercase, number, and special character.';
  }

  if (errorCode === 'password-mismatch') {
    errorMessage = 'New password and confirm password do not match.';
  }

  if (errorCode === 'password-update-failed') {
    errorMessage = 'Failed to update password. Please try again.';
  }

  return res.render('admin-profile', {
    title: 'Admin Profile | BhutanDevi Trade and Suppliers',
    username: authConfig.username,
    statusMessage: req.query.status === 'password-updated' ? 'Password updated successfully. Please log in again with your new password.' : '',
    errorMessage: errorMessage,
  });
}

async function handleAdminUpdatePassword(req, res) {
  let currentPassword = String(req.body.currentPassword || '');
  let newPassword = String(req.body.newPassword || '');
  let confirmPassword = String(req.body.confirmPassword || '');
  let authConfig = adminAuth.getAuthConfig();
  let isAjax = isAjaxRequest(req);

  if (!currentPassword || currentPassword.length > maxAdminPasswordLength) {
    return sendPasswordUpdateError(res, isAjax, 'invalid-current-password', 400, 'Current password is required');
  }

  if (
    newPassword.length < minAdminPasswordLength ||
    newPassword.length > maxAdminPasswordLength ||
    !adminPasswordPattern.test(newPassword)
  ) {
    return sendPasswordUpdateError(
      res,
      isAjax,
      'invalid-new-password',
      400,
      'New password must be 8-128 characters and include uppercase, lowercase, number, and special character'
    );
  }

  if (confirmPassword !== newPassword) {
    return sendPasswordUpdateError(res, isAjax, 'password-mismatch', 400, 'New password and confirm password do not match');
  }

  // Validate current password
  if (!adminAuth.validateCredentials(authConfig.username, currentPassword)) {
    return sendPasswordUpdateError(res, isAjax, 'invalid-current-password', 401, 'Current password is incorrect');
  }

  // Update password in environment (this will require server restart to take effect)
  // For persistent storage, you'd need to update a config file or database
  try {
    // Note: In production, you should store this in a database or encrypted config file
    // For now, we'll update the process.env (requires restart) or write to .env file
    let envPath = path.join(process.cwd(), '.env');
    let envContent = await fs.promises.readFile(envPath, 'utf8');

    // Update ADMIN_PASSWORD in .env file
    let passwordRegex = /^(ADMIN_PASSWORD=).*$/m;
    if (passwordRegex.test(envContent)) {
      envContent = envContent.replace(passwordRegex, '$1' + newPassword);
    } else {
      envContent += '\nADMIN_PASSWORD=' + newPassword;
    }

    await fs.promises.writeFile(envPath, envContent, 'utf8');

    // Update runtime config
    process.env.ADMIN_PASSWORD = newPassword;

    // Clear auth cookie to force re-login
    adminAuth.clearAuthCookie(res);

    if (isAjax) {
      return res.json({
        success: true,
        message: 'Password updated successfully. Please log in again with your new password.',
        redirectUrl: '/admin/login'
      });
    }

    return res.redirect('/admin/profile?status=password-updated');
  } catch (error) {
    console.error('Failed to update admin password:', error);
    return sendPasswordUpdateError(res, isAjax, 'password-update-failed', 500, 'Failed to update password. Please try again.');
  }
}
export default {
  handleAdminLogin: handleAdminLogin,
  handleAdminLogout: handleAdminLogout,
  handleAdminUpdatePassword: handleAdminUpdatePassword,
  renderAdminLogin: renderAdminLogin,
  renderAdminProfile: renderAdminProfile,
  requireAdminAuth: adminAuth.requireAdminAuth,
};
