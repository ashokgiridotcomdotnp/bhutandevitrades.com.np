(function () {
  var TOAST_MAX_COUNT = 5;
  var TOAST_DURATION_SUCCESS = 3200;
  var TOAST_DURATION_ERROR = 4500;
  var TOAST_ROOT_ID = 'bd-toast-root';

  function getToastRoot() {
    var existingRoot = document.getElementById(TOAST_ROOT_ID);

    if (existingRoot) {
      return existingRoot;
    }

    var root = document.createElement('div');
    root.id = TOAST_ROOT_ID;
    root.style.position = 'fixed';
    root.style.top = '1rem';
    root.style.right = '1rem';
    root.style.zIndex = '9999';
    root.style.display = 'flex';
    root.style.flexDirection = 'column';
    root.style.gap = '0.5rem';
    root.style.width = 'min(24rem, calc(100vw - 1.5rem))';
    root.style.pointerEvents = 'none';
    document.body.appendChild(root);
    return root;
  }

  function removeToast(toast) {
    if (!toast || !toast.parentNode) {
      return;
    }

    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-6px)';
    window.setTimeout(function () {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 180);
  }

  function extractAlertMessage(alert) {
    if (!alert) {
      return '';
    }

    var dedicatedMessage = alert.querySelector('[data-toast-message]');
    var clonedNode = null;

    if (dedicatedMessage) {
      return String(dedicatedMessage.textContent || '').trim();
    }

    clonedNode = alert.cloneNode(true);
    clonedNode.querySelectorAll('button,[data-dismiss-alert]').forEach(function (node) {
      if (node && node.parentNode) {
        node.parentNode.removeChild(node);
      }
    });

    return String(clonedNode.textContent || '').trim();
  }

  function normalizeToastInput(messageOrConfig, fallbackType) {
    if (typeof messageOrConfig === 'string') {
      return {
        message: messageOrConfig,
        type: fallbackType === 'error' ? 'error' : 'success',
      };
    }

    if (!messageOrConfig || typeof messageOrConfig !== 'object') {
      return null;
    }

    return {
      message: String(messageOrConfig.message || '').trim(),
      type: messageOrConfig.type === 'error' ? 'error' : 'success',
      duration: Number(messageOrConfig.duration),
    };
  }

  function clearFlashQueryParams() {
    var currentUrl = null;
    var hasStatus = false;
    var hasError = false;
    var nextQuery = '';
    var nextUrl = '';

    if (!window.history || typeof window.history.replaceState !== 'function') {
      return;
    }

    try {
      currentUrl = new URL(window.location.href);
    } catch (error) {
      return;
    }

    hasStatus = currentUrl.searchParams.has('status');
    hasError = currentUrl.searchParams.has('error');

    if (!hasStatus && !hasError) {
      return;
    }

    currentUrl.searchParams.delete('status');
    currentUrl.searchParams.delete('error');

    nextQuery = currentUrl.searchParams.toString();
    nextUrl = currentUrl.pathname + (nextQuery ? '?' + nextQuery : '') + currentUrl.hash;
    window.history.replaceState({}, document.title, nextUrl);
  }

  function showToast(messageOrConfig, fallbackType) {
    var toastConfig = normalizeToastInput(messageOrConfig, fallbackType);
    var toastRoot = null;
    var toast = null;
    var body = null;
    var message = '';
    var type = 'success';
    var duration = TOAST_DURATION_SUCCESS;
    var closeButton = null;
    var content = null;
    var icon = null;
    var backgroundColor = '#ecfdf5';
    var borderColor = '#86efac';
    var textColor = '#047857';

    if (!toastConfig || !toastConfig.message) {
      return;
    }

    message = toastConfig.message;
    type = toastConfig.type;

    if (type === 'error') {
      duration = TOAST_DURATION_ERROR;
      backgroundColor = '#fef2f2';
      borderColor = '#fca5a5';
      textColor = '#b91c1c';
    }

    if (Number.isFinite(toastConfig.duration) && toastConfig.duration > 0) {
      duration = Math.floor(toastConfig.duration);
    }

    toastRoot = getToastRoot();

    while (toastRoot.children.length >= TOAST_MAX_COUNT) {
      removeToast(toastRoot.firstElementChild);
    }

    toast = document.createElement('div');
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.style.pointerEvents = 'auto';
    toast.style.display = 'flex';
    toast.style.alignItems = 'center';
    toast.style.justifyContent = 'space-between';
    toast.style.gap = '0.5rem';
    toast.style.border = '1px solid ' + borderColor;
    toast.style.background = backgroundColor;
    toast.style.color = textColor;
    toast.style.borderRadius = '0.75rem';
    toast.style.padding = '0.7rem 0.8rem';
    toast.style.fontSize = '0.875rem';
    toast.style.fontWeight = '600';
    toast.style.lineHeight = '1.35';
    toast.style.boxShadow = '0 12px 24px rgba(15, 23, 42, 0.12)';
    toast.style.backdropFilter = 'blur(2px)';
    toast.style.transition = 'opacity 180ms ease, transform 180ms ease';
    toast.style.opacity = '1';
    toast.style.transform = 'translateY(0)';

    content = document.createElement('div');
    content.style.flex = '1 1 auto';
    content.style.display = 'flex';
    content.style.alignItems = 'center';
    content.style.gap = '0.5rem';

    if (type !== 'error') {
      icon = document.createElement('img');
      icon.src = '/icons/tick.svg';
      icon.alt = '';
      icon.setAttribute('aria-hidden', 'true');
      icon.style.flex = '0 0 auto';
      icon.style.width = '1rem';
      icon.style.height = '1rem';
      icon.style.marginTop = '0';
      content.appendChild(icon);
    }

    body = document.createElement('div');
    body.style.flex = '1 1 auto';
    body.textContent = message;
    content.appendChild(body);
    toast.appendChild(content);

    closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Dismiss message');
    closeButton.textContent = '×';
    closeButton.style.flex = '0 0 auto';
    closeButton.style.width = '1.4rem';
    closeButton.style.height = '1.4rem';
    closeButton.style.display = 'inline-flex';
    closeButton.style.alignItems = 'center';
    closeButton.style.justifyContent = 'center';
    closeButton.style.borderRadius = '9999px';
    closeButton.style.border = '1px solid ' + borderColor;
    closeButton.style.background = 'rgba(255,255,255,0.85)';
    closeButton.style.color = textColor;
    closeButton.style.cursor = 'pointer';
    closeButton.style.fontWeight = '700';
    closeButton.style.fontSize = '0.95rem';
    closeButton.style.lineHeight = '1';
    closeButton.style.padding = '0';
    closeButton.addEventListener('click', function () {
      removeToast(toast);
    });
    toast.appendChild(closeButton);

    toastRoot.appendChild(toast);
    window.setTimeout(function () {
      removeToast(toast);
    }, duration);
  }

  function consumeInlineAlerts() {
    var alerts = document.querySelectorAll('[data-success-alert], [data-error-alert]');
    var hasConsumedAnyAlert = false;

    if (!alerts.length) {
      return;
    }

    alerts.forEach(function (alert) {
      var message = extractAlertMessage(alert);
      var type = alert.hasAttribute('data-error-alert') ? 'error' : 'success';

      if (message) {
        hasConsumedAnyAlert = true;
        showToast({
          type: type,
          message: message,
        });
      }

      if (alert.parentNode) {
        alert.parentNode.removeChild(alert);
      }
    });

    if (hasConsumedAnyAlert) {
      clearFlashQueryParams();
    }
  }

  window.bdShowToast = showToast;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', consumeInlineAlerts);
    return;
  }

  consumeInlineAlerts();
})();
