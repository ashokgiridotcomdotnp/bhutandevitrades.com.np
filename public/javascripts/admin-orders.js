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

  function showToast(type, message) {
    if (typeof window.bdShowToast === 'function') {
      window.bdShowToast({
        type: type,
        message: message,
      });
      return;
    }
    if (message) {
      window.alert(message);
    }
  }

  function setLoadingOverlay(isVisible) {
    var globalLoading = window.bdLoading || null;
    if (!globalLoading || typeof globalLoading !== 'object') {
      return;
    }
    if (isVisible) {
      if (typeof globalLoading.show === 'function') {
        globalLoading.show();
      }
      return;
    }
    if (typeof globalLoading.hide === 'function') {
      globalLoading.hide();
    }
  }

  async function submitOrderFormAsync(form) {
    var response = null;
    var result = null;
    var orderId = null;
    var formPayload = null;

    if (!form) {
      return;
    }

    setLoadingOverlay(true);

    try {
      formPayload = new URLSearchParams(new FormData(form));
      response = await fetch(form.action, {
        method: 'POST',
        body: formPayload,
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
      });

      if (response.url && response.url.indexOf('/admin/login') !== -1) {
        window.location.href = '/admin/login';
        return;
      }

      result = await response.json();

      if (result.success) {
        showToast('success', result.message || 'Operation successful');
        // Remove the row from DOM
        orderId = form.querySelector('input[name="orderId"]')?.value;
        if (orderId) {
          var row = form.closest('tr');
          if (row) {
            row.style.transition = 'opacity 0.3s ease';
            row.style.opacity = '0';
            setTimeout(function () {
              row.remove();
            }, 300);
          }
        }
      } else {
        showToast('error', result.message || 'Operation failed');
      }
    } catch (error) {
      showToast('error', 'Failed to process request. Please try again.');
    } finally {
      setLoadingOverlay(false);
    }
  }

  function bindOrdersLoadingState() {
    var links = Array.prototype.slice.call(document.querySelectorAll('[data-orders-nav-link]'));

    links.forEach(function (link) {
      link.addEventListener('click', function (event) {
        if (link.getAttribute('aria-disabled') === 'true') {
          event.preventDefault();
          return;
        }
        setOrdersLoadingState(true);
      });
    });

    // Handle accept forms
    document.querySelectorAll('form[action="/admin/orders/accept"]').forEach(function (form) {
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        submitOrderFormAsync(form);
      });
    });

    // Handle delete forms
    document.querySelectorAll('form[action="/admin/orders/delete"]').forEach(function (form) {
      form.removeAttribute('onsubmit');
      form.addEventListener('submit', function (event) {
        event.preventDefault();
        if (window.confirm('Delete this order request?')) {
          submitOrderFormAsync(form);
        }
      });
    });
  }

  sanitizeUrlQuery();
  setOrdersLoadingState(false);
  bindOrdersLoadingState();
})();
