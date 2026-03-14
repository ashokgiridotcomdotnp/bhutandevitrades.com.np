(function () {
  function isSuccessResponsePayload(payload) {
    return Boolean(payload && (payload.success === true || payload.ok === true));
  }

  function buildResponseMessage(payload, fallbackMessage) {
    if (payload && typeof payload === 'object') {
      let message = String(payload.message || payload.error || payload.errorCode || '').trim();
      let requestId = String(payload.requestId || '').trim();

      if (message && requestId) {
        return message + ' (Request ID: ' + requestId + ')';
      }

      if (message) {
        return message;
      }
    }

    return String(fallbackMessage || '').trim() || 'Request failed. Please try again.';
  }

  async function readResponsePayload(response) {
    let text = '';

    try {
      text = await response.text();
    } catch (error) {
      return { payload: null, text: '' };
    }

    if (!text) {
      return { payload: null, text: '' };
    }

    try {
      return { payload: JSON.parse(text), text: text };
    } catch (error) {
      return { payload: null, text: text };
    }
  }

  async function fetchAdminJson(url, options) {
    let response = await fetch(url, options);

    if (response && response.url) {
      try {
        let finalUrl = new URL(response.url, window.location.href);
        if (finalUrl.pathname === '/admin/login') {
          window.location.href = '/admin/login';
          return { response: response, payload: null, redirectedToLogin: true };
        }
      } catch (error) {
        // ignore URL parsing issues
      }
    }

    let payloadResult = await readResponsePayload(response);

    return {
      response: response,
      payload: payloadResult.payload,
      redirectedToLogin: false,
    };
  }

  function replaceStateWithUrl(url) {
    if (!window.history || typeof window.history.replaceState !== 'function') {
      return;
    }

    let nextQuery = url.searchParams.toString();
    let nextUrl = url.pathname + (nextQuery ? '?' + nextQuery : '') + url.hash;
    window.history.replaceState({}, document.title, nextUrl);
  }

  function sanitizeUrlQuery() {
    let currentUrl = new URL(window.location.href);
    let hasStatus = currentUrl.searchParams.has('status');
    let hasError = currentUrl.searchParams.has('error');

    if (!hasStatus && !hasError) {
      return;
    }

    currentUrl.searchParams.delete('status');
    currentUrl.searchParams.delete('error');
    replaceStateWithUrl(currentUrl);
  }

  function setOrdersLoadingState(isLoading) {
    let skeletonPanel = document.querySelector('[data-orders-skeleton]');
    let contentPanel = document.querySelector('[data-orders-content]');

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
    let globalLoading = window.bdLoading || null;
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
    let response = null;
    let result = null;
    let orderId = null;
    let formPayload = null;

    if (!form) {
      return;
    }

    setLoadingOverlay(true);

    try {
      formPayload = new URLSearchParams(new FormData(form));
      let fetchResult = await fetchAdminJson(form.action, {
        method: 'POST',
        body: formPayload,
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        },
      });

      if (fetchResult.redirectedToLogin) {
        return;
      }

      response = fetchResult.response;
      result = fetchResult.payload;

      if (!result || typeof result !== 'object') {
        showToast('error', 'Unexpected server response. Please refresh and try again.');
        return;
      }

      if (isSuccessResponsePayload(result)) {
        showToast('success', buildResponseMessage(result, 'Operation successful'));
        // Remove the row from DOM
        orderId = form.querySelector('input[name="orderId"]')?.value;
        if (orderId) {
          let row = form.closest('tr');
          if (row) {
            row.style.transition = 'opacity 0.3s ease';
            row.style.opacity = '0';
            setTimeout(function () {
              row.remove();
            }, 300);
          }
        }
      } else {
        showToast('error', buildResponseMessage(result, 'Operation failed'));
      }
    } catch (error) {
      showToast('error', 'Failed to process request. Please try again.');
    } finally {
      setLoadingOverlay(false);
    }
  }

  function bindOrdersLoadingState() {
    let links = Array.prototype.slice.call(document.querySelectorAll('[data-orders-nav-link]'));

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
