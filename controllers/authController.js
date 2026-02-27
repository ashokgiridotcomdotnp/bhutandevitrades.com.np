var adminAuth = require('../lib/adminAuth');
var fs = require('fs');
var path = require('path');

function renderAdminLogin(req, res) {
  var legacyNextPath = adminAuth.getSafeAdminNextPath(req.query.next);
  var legacyErrorCode = String(req.query.error || '').trim();
  var legacyStatusCode = String(req.query.status || '').trim();
  var hasLegacyQueryState = Boolean(legacyNextPath !== '/admin' || legacyErrorCode || legacyStatusCode);
  var loginState = null;
  var nextPath = legacyNextPath;
  var authConfig = adminAuth.getAuthConfig();
  var hasAuthEnabled = authConfig.enabled;
  var hasAuthConfigured = authConfig.configured;
  var errorCode = '';
  var statusCode = '';
  var errorMessage = '';
  var statusMessage = '';

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
  var username = String(req.body.username || '').trim();
  var password = String(req.body.password || '');
  var loginState = adminAuth.getLoginState(req);
  var nextPath = adminAuth.getSafeAdminNextPath(req.body.next || loginState.nextPath);
  var authConfig = adminAuth.getAuthConfig();

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
  return res.redirect(nextPath);
}

async function handleAdminLogout(req, res) {
  adminAuth.clearAuthCookie(res);
  adminAuth.setLoginState(res, req, 'logged-out', '', '/admin');
  return res.redirect('/admin/login');
}

async function renderAdminProfile(req, res) {
  var authConfig = adminAuth.getAuthConfig();
  var isAjax = req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest' || req.headers.accept === 'application/json';

  if (isAjax) {
    return res.json({
      success: true,
      username: authConfig.username,
    });
  }

  return res.render('admin-profile', {
    title: 'Admin Profile | BhutanDevi Trade and Suppliers',
    username: authConfig.username,
    statusMessage: req.query.status === 'password-updated' ? 'Password updated successfully. Please log in again with your new password.' : '',
    errorMessage: req.query.error === 'invalid-current-password' ? 'Current password is incorrect.' :
      req.query.error === 'password-update-failed' ? 'Failed to update password. Please try again.' : '',
  });
}

async function handleAdminUpdatePassword(req, res) {
  var currentPassword = String(req.body.currentPassword || '');
  var newPassword = String(req.body.newPassword || '');
  var authConfig = adminAuth.getAuthConfig();
  var isAjax = req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest' || req.headers.accept === 'application/json';

  // Validate current password
  if (!adminAuth.validateCredentials(authConfig.username, currentPassword)) {
    if (isAjax) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect' });
    }
    return res.redirect('/admin/profile?error=invalid-current-password');
  }

  // Update password in environment (this will require server restart to take effect)
  // For persistent storage, you'd need to update a config file or database
  try {
    // Note: In production, you should store this in a database or encrypted config file
    // For now, we'll update the process.env (requires restart) or write to .env file
    var envPath = path.join(process.cwd(), '.env');
    var envContent = await fs.promises.readFile(envPath, 'utf8');

    // Update ADMIN_PASSWORD in .env file
    var passwordRegex = /^(ADMIN_PASSWORD=).*$/m;
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
    if (isAjax) {
      return res.status(500).json({ success: false, message: 'Failed to update password. Please try again.' });
    }
    return res.redirect('/admin/profile?error=password-update-failed');
  }
}

module.exports = {
  handleAdminLogin: handleAdminLogin,
  handleAdminLogout: handleAdminLogout,
  handleAdminUpdatePassword: handleAdminUpdatePassword,
  renderAdminLogin: renderAdminLogin,
  renderAdminProfile: renderAdminProfile,
  requireAdminAuth: adminAuth.requireAdminAuth,
};
