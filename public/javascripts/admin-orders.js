(function () {
  if (!window.history || typeof window.history.replaceState !== 'function') {
    return;
  }

  var currentUrl = new URL(window.location.href);
  var hasStatus = currentUrl.searchParams.has('status');
  var hasError = currentUrl.searchParams.has('error');

  if (!hasStatus && !hasError) {
    return;
  }

  currentUrl.searchParams.delete('status');
  currentUrl.searchParams.delete('error');

  var nextQuery = currentUrl.searchParams.toString();
  var nextUrl = currentUrl.pathname + (nextQuery ? '?' + nextQuery : '') + currentUrl.hash;
  window.history.replaceState({}, document.title, nextUrl);
})();
