var adminAuth = require('../lib/adminAuth');

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

function handleAdminLogin(req, res) {
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

function handleAdminLogout(req, res) {
  adminAuth.clearAuthCookie(res);
  adminAuth.setLoginState(res, req, 'logged-out', '', '/admin');
  return res.redirect('/admin/login');
}

module.exports = {
  handleAdminLogin: handleAdminLogin,
  handleAdminLogout: handleAdminLogout,
  renderAdminLogin: renderAdminLogin,
  requireAdminAuth: adminAuth.requireAdminAuth,
};
