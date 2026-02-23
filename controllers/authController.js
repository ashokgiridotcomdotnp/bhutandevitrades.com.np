var adminAuth = require('../lib/adminAuth');

function renderAdminLogin(req, res) {
  var nextPath = adminAuth.getSafeAdminNextPath(req.query.next);
  var hasAuthEnabled = adminAuth.getAuthConfig().enabled;
  var errorCode = String(req.query.error || '').trim();
  var statusCode = String(req.query.status || '').trim();
  var errorMessage = '';
  var statusMessage = '';

  if (adminAuth.isAuthenticatedRequest(req)) {
    return res.redirect(nextPath);
  }

  if (errorCode === 'invalid-credentials') {
    errorMessage = 'Invalid username or password.';
  }

  if (statusCode === 'logged-out') {
    statusMessage = 'You have been logged out.';
  }

  return res.render('admin-login', {
    title: 'Admin Login | BhutanDevi Trade and Suppliers',
    nextPath: nextPath,
    hasAuthEnabled: hasAuthEnabled,
    statusMessage: statusMessage,
    errorMessage: errorMessage,
  });
}

function handleAdminLogin(req, res) {
  var username = String(req.body.username || '').trim();
  var password = String(req.body.password || '');
  var nextPath = adminAuth.getSafeAdminNextPath(req.body.next);

  if (!adminAuth.getAuthConfig().enabled) {
    return res.redirect(nextPath);
  }

  if (!adminAuth.validateCredentials(username, password)) {
    return res.redirect('/admin/login?error=invalid-credentials&next=' + encodeURIComponent(nextPath));
  }

  adminAuth.setAuthCookie(res, username);
  return res.redirect(nextPath);
}

function handleAdminLogout(req, res) {
  adminAuth.clearAuthCookie(res);
  return res.redirect('/admin/login?status=logged-out');
}

module.exports = {
  handleAdminLogin: handleAdminLogin,
  handleAdminLogout: handleAdminLogout,
  renderAdminLogin: renderAdminLogin,
  requireAdminAuth: adminAuth.requireAdminAuth,
};
