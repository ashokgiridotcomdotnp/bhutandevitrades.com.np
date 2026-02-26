(function () {
  var overlayElement = null;
  var isVisible = false;
  var pendingShowTimerId = null;
  var fallbackHideTimerId = null;
  var showDelayMs = 140;

  function getOverlayElement() {
    if (overlayElement && document.body.contains(overlayElement)) {
      return overlayElement;
    }

    overlayElement = document.querySelector('[data-global-loading-overlay]');
    return overlayElement;
  }

  function setOverlayVisible(shouldShow) {
    var overlay = getOverlayElement();

    if (!overlay) {
      return;
    }

    isVisible = Boolean(shouldShow);
    overlay.classList.toggle('hidden', !isVisible);
    overlay.classList.toggle('flex', isVisible);
    overlay.classList.toggle('pointer-events-none', !isVisible);
    overlay.classList.toggle('pointer-events-auto', isVisible);
    overlay.setAttribute('aria-hidden', isVisible ? 'false' : 'true');

    if (fallbackHideTimerId) {
      window.clearTimeout(fallbackHideTimerId);
      fallbackHideTimerId = null;
    }

    if (isVisible) {
      // Guard against edge-cases where navigation is cancelled and the overlay could remain open.
      fallbackHideTimerId = window.setTimeout(function () {
        setOverlayVisible(false);
      }, 15000);
    }
  }

  function normalizeFormMethod(form) {
    var rawMethod = String(form.getAttribute('method') || 'get').trim().toLowerCase();
    return rawMethod || 'get';
  }

  function shouldHandleForm(form) {
    var formTarget = '';
    var formMethod = '';

    if (!form || form.tagName !== 'FORM') {
      return false;
    }

    if (form.hasAttribute('data-skip-global-loading')) {
      return false;
    }

    formTarget = String(form.getAttribute('target') || '').trim().toLowerCase();
    if (formTarget && formTarget !== '_self') {
      return false;
    }

    formMethod = normalizeFormMethod(form);
    if (formMethod === 'get' || formMethod === 'dialog') {
      return false;
    }

    return true;
  }

  function showGlobalLoading() {
    cancelScheduledShow();
    setOverlayVisible(true);
  }

  function hideGlobalLoading() {
    cancelScheduledShow();
    setOverlayVisible(false);
  }

  function scheduleShowGlobalLoading() {
    cancelScheduledShow();
    pendingShowTimerId = window.setTimeout(function () {
      pendingShowTimerId = null;
      showGlobalLoading();
    }, showDelayMs);
  }

  function cancelScheduledShow() {
    if (!pendingShowTimerId) {
      return;
    }

    window.clearTimeout(pendingShowTimerId);
    pendingShowTimerId = null;
  }

  function handleFormSubmit(event) {
    var submittedForm = event.target;

    if (!shouldHandleForm(submittedForm)) {
      return;
    }

    // Let per-page handlers cancel submit first.
    window.setTimeout(function () {
      if (event.defaultPrevented) {
        return;
      }

      scheduleShowGlobalLoading();
    }, 0);
  }

  function isModifiedClick(event) {
    return Boolean(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);
  }

  function isSamePageHashNavigation(nextUrl) {
    return Boolean(
      nextUrl
      && nextUrl.hash
      && nextUrl.origin === window.location.origin
      && nextUrl.pathname === window.location.pathname
      && nextUrl.search === window.location.search
    );
  }

  function isHandleableAnchor(anchor, event) {
    var hrefValue = '';
    var targetValue = '';
    var resolvedUrl = null;

    if (!anchor || anchor.tagName !== 'A') {
      return false;
    }

    if (anchor.hasAttribute('data-skip-global-loading')) {
      return false;
    }

    if (event.defaultPrevented || event.button !== 0 || isModifiedClick(event)) {
      return false;
    }

    targetValue = String(anchor.getAttribute('target') || '').trim().toLowerCase();
    if (targetValue && targetValue !== '_self') {
      return false;
    }

    if (anchor.hasAttribute('download')) {
      return false;
    }

    hrefValue = String(anchor.getAttribute('href') || '').trim();
    if (!hrefValue || hrefValue.indexOf('javascript:') === 0) {
      return false;
    }

    try {
      resolvedUrl = new URL(anchor.href, window.location.href);
    } catch (error) {
      return false;
    }

    if (!resolvedUrl || resolvedUrl.origin !== window.location.origin) {
      return false;
    }

    if (resolvedUrl.protocol !== 'http:' && resolvedUrl.protocol !== 'https:') {
      return false;
    }

    if (isSamePageHashNavigation(resolvedUrl)) {
      return false;
    }

    if (resolvedUrl.href === window.location.href) {
      return false;
    }

    return true;
  }

  function handleDocumentClick(event) {
    var targetNode = event.target;
    var anchor = targetNode && typeof targetNode.closest === 'function'
      ? targetNode.closest('a')
      : null;

    if (!isHandleableAnchor(anchor, event)) {
      return;
    }

    window.setTimeout(function () {
      if (event.defaultPrevented) {
        return;
      }

      scheduleShowGlobalLoading();
    }, 0);
  }

  function patchNativeFormSubmit() {
    var prototypeRef = null;
    var nativeSubmit = null;

    if (!window.HTMLFormElement || !window.HTMLFormElement.prototype) {
      return;
    }

    prototypeRef = window.HTMLFormElement.prototype;
    if (prototypeRef.__bdGlobalLoadingPatched) {
      return;
    }

    nativeSubmit = prototypeRef.submit;
    if (typeof nativeSubmit !== 'function') {
      return;
    }

    prototypeRef.submit = function patchedSubmit() {
      if (shouldHandleForm(this)) {
        scheduleShowGlobalLoading();
      }

      return nativeSubmit.apply(this, arguments);
    };

    prototypeRef.__bdGlobalLoadingPatched = true;
  }

  function initGlobalLoading() {
    patchNativeFormSubmit();
    document.addEventListener('submit', handleFormSubmit, true);
    document.addEventListener('click', handleDocumentClick, true);
    window.addEventListener('pagehide', cancelScheduledShow);
    window.addEventListener('pageshow', hideGlobalLoading);
    window.addEventListener('load', hideGlobalLoading);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') {
        hideGlobalLoading();
      }
    });
    window.bdLoading = {
      show: showGlobalLoading,
      hide: hideGlobalLoading,
      isVisible: function () {
        return isVisible;
      },
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initGlobalLoading);
    return;
  }

  initGlobalLoading();
})();
