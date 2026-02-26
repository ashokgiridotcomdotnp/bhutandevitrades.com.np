(function () {
  function replaceStateWithUrl(url) {
    if (!window.history || typeof window.history.replaceState !== 'function') {
      return;
    }

    var nextQuery = url.searchParams.toString();
    var nextUrl = url.pathname + (nextQuery ? '?' + nextQuery : '') + url.hash;
    window.history.replaceState({}, document.title, nextUrl);
  }

  function sanitizeUrlQuery() {
    var currentUrl = new URL(window.location.href);
    var hasStatus = currentUrl.searchParams.has('status');
    var hasError = currentUrl.searchParams.has('error');

    if (!hasStatus && !hasError) {
      return;
    }

    currentUrl.searchParams.delete('status');
    currentUrl.searchParams.delete('error');
    replaceStateWithUrl(currentUrl);
  }

  function setOrdersLoadingState(isLoading) {
    var skeletonPanel = document.querySelector('[data-orders-skeleton]');
    var contentPanel = document.querySelector('[data-orders-content]');

    if (!skeletonPanel || !contentPanel) {
      return;
    }

    skeletonPanel.classList.toggle('hidden', !isLoading);
    contentPanel.classList.toggle('hidden', isLoading);
  }

  function bindOrdersLoadingState() {
    var links = Array.prototype.slice.call(document.querySelectorAll('[data-orders-nav-link]'));
    var forms = Array.prototype.slice.call(document.querySelectorAll('[data-orders-nav-form]'));

    links.forEach(function (link) {
      link.addEventListener('click', function (event) {
        if (link.getAttribute('aria-disabled') === 'true') {
          event.preventDefault();
          return;
        }

        setOrdersLoadingState(true);
      });
    });

    forms.forEach(function (form) {
      form.addEventListener('submit', function (event) {
        window.setTimeout(function () {
          if (event.defaultPrevented) {
            return;
          }

          setOrdersLoadingState(true);
        }, 0);
      });
    });
  }

  sanitizeUrlQuery();
  setOrdersLoadingState(false);
  bindOrdersLoadingState();
})();
