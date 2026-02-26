(function () {
  var TOAST_MAX_COUNT = 5;
  var TOAST_DURATION_SUCCESS = 3200;
  var TOAST_DURATION_ERROR = 4500;
  var TOAST_DURATION_WARNING = 4000;
  var TOAST_ROOT_ID = 'bd-toast-root';

  function getToastRoot() {
    var existingRoot = document.getElementById(TOAST_ROOT_ID);

    if (existingRoot) {
      return existingRoot;
    }

    var root = document.createElement('div');
    root.id = TOAST_ROOT_ID;
    root.className = 'bd-toast-root';
    document.body.appendChild(root);
    return root;
  }

  function removeToast(toast) {
    if (!toast || !toast.parentNode) {
      return;
    }

    toast.classList.remove('is-visible');
    toast.classList.add('is-leaving');
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
        type: fallbackType === 'error' ? 'error' : fallbackType === 'warning' ? 'warning' : 'success',
      };
    }

    if (!messageOrConfig || typeof messageOrConfig !== 'object') {
      return null;
    }

    return {
      message: String(messageOrConfig.message || '').trim(),
      type: messageOrConfig.type === 'error' ? 'error' : messageOrConfig.type === 'warning' ? 'warning' : 'success',
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

  function getToastIconPath(type) {
    if (type === 'error') {
      return 'M6 18 17.94 6M18 18 6.06 6';
    }

    if (type === 'warning') {
      return 'M12 13V8m0 8h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z';
    }

    return 'M5 11.917 9.724 16.5 19 7.5';
  }

  function getToastIconClassName(type) {
    if (type === 'error') {
      return 'inline-flex items-center justify-center shrink-0 w-7 h-7 text-fg-danger bg-danger-soft rounded';
    }

    if (type === 'warning') {
      return 'inline-flex items-center justify-center shrink-0 w-7 h-7 text-fg-warning bg-warning-soft rounded';
    }

    return 'inline-flex items-center justify-center shrink-0 w-7 h-7 text-fg-success bg-success-soft rounded';
  }

  function getToastIconLabel(type) {
    if (type === 'error') {
      return 'Error icon';
    }

    if (type === 'warning') {
      return 'Warning icon';
    }

    return 'Check icon';
  }

  function createSvg(pathValue) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');

    svg.setAttribute('class', 'w-5 h-5');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('viewBox', '0 0 24 24');

    path.setAttribute('stroke', 'currentColor');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    path.setAttribute('stroke-width', '2');
    path.setAttribute('d', pathValue);

    svg.appendChild(path);
    return svg;
  }

  function createToast(toastId, type, message) {
    var toast = document.createElement('div');
    var iconWrap = document.createElement('div');
    var iconSrText = document.createElement('span');
    var messageWrap = document.createElement('div');
    var button = document.createElement('button');
    var buttonSrText = document.createElement('span');
    var closeSvg = createSvg('M6 18 17.94 6M18 18 6.06 6');

    toast.id = toastId;
    toast.className = 'bd-toast-item flex items-center w-full max-w-sm p-4 text-body bg-neutral-primary-soft rounded-base shadow-xs border border-default';
    toast.setAttribute('role', 'alert');

    iconWrap.className = getToastIconClassName(type);
    iconWrap.appendChild(createSvg(getToastIconPath(type)));

    iconSrText.className = 'sr-only';
    iconSrText.textContent = getToastIconLabel(type);
    iconWrap.appendChild(iconSrText);
    toast.appendChild(iconWrap);

    messageWrap.className = 'ms-3 text-sm font-normal';
    messageWrap.textContent = message;
    toast.appendChild(messageWrap);

    button.type = 'button';
    button.className = 'ms-auto flex items-center justify-center text-body hover:text-heading bg-transparent box-border border border-transparent hover:bg-neutral-secondary-medium focus:ring-4 focus:ring-neutral-tertiary font-medium leading-5 rounded text-sm h-8 w-8 focus:outline-none';
    button.setAttribute('data-dismiss-target', '#' + toastId);
    button.setAttribute('aria-label', 'Close');

    buttonSrText.className = 'sr-only';
    buttonSrText.textContent = 'Close';
    button.appendChild(buttonSrText);
    button.appendChild(closeSvg);
    toast.appendChild(button);

    return toast;
  }

  function showToast(messageOrConfig, fallbackType) {
    var toastConfig = normalizeToastInput(messageOrConfig, fallbackType);
    var toastRoot = null;
    var toast = null;
    var toastId = '';
    var message = '';
    var type = 'success';
    var duration = TOAST_DURATION_SUCCESS;
    var closeButton = null;

    if (!toastConfig || !toastConfig.message) {
      return;
    }

    message = toastConfig.message;
    type = toastConfig.type;

    if (type === 'error') {
      duration = TOAST_DURATION_ERROR;
    } else if (type === 'warning') {
      duration = TOAST_DURATION_WARNING;
    }

    if (Number.isFinite(toastConfig.duration) && toastConfig.duration > 0) {
      duration = Math.floor(toastConfig.duration);
    }

    toastRoot = getToastRoot();

    while (toastRoot.children.length >= TOAST_MAX_COUNT) {
      removeToast(toastRoot.firstElementChild);
    }

    toastId = 'toast-' + type + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
    toast = createToast(toastId, type, message);
    closeButton = toast.querySelector('button[data-dismiss-target]');
    closeButton.addEventListener('click', function () {
      removeToast(toast);
    });

    toastRoot.appendChild(toast);
    window.requestAnimationFrame(function () {
      toast.classList.add('is-visible');
    });

    window.setTimeout(function () {
      removeToast(toast);
    }, duration);
  }

  function consumeInlineAlerts() {
    var alerts = document.querySelectorAll('[data-success-alert], [data-error-alert], [data-warning-alert]');
    var hasConsumedAnyAlert = false;

    if (!alerts.length) {
      return;
    }

    alerts.forEach(function (alert) {
      var message = extractAlertMessage(alert);
      var type = 'success';

      if (alert.hasAttribute('data-error-alert')) {
        type = 'error';
      } else if (alert.hasAttribute('data-warning-alert')) {
        type = 'warning';
      }

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
