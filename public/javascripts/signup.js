(function () {
  function toTrimmedString(value) {
    return String(value || '').trim();
  }

  function resolveSubmitButton(form, submitter) {
    if (submitter && submitter.form === form) {
      return submitter;
    }

    return form.querySelector('button[type="submit"], input[type="submit"]');
  }

  function getLoadingLabel(form, submitButton) {
    var customLabel = submitButton ? toTrimmedString(submitButton.getAttribute('data-loading-label')) : '';

    if (customLabel) {
      return customLabel;
    }

    if (form.querySelector('input[name="verificationCode"]')) {
      return 'Verifying... please wait';
    }

    if (form.querySelector('input[name="password"]')) {
      return 'Sending code... async may take a moment';
    }

    return 'Please wait...';
  }

  function setButtonLabel(button, label) {
    if (!button) {
      return;
    }

    if (button.tagName === 'INPUT') {
      button.value = label;
      return;
    }

    button.textContent = label;
  }

  function handleSignupSubmit(event) {
    var form = event.target;
    var submitButton = null;
    var loadingLabel = '';
    var originalLabel = '';

    if (!form || form.tagName !== 'FORM') {
      return;
    }

    if (toTrimmedString(form.getAttribute('action')) !== '/signup') {
      return;
    }

    if (event.defaultPrevented) {
      return;
    }

    submitButton = resolveSubmitButton(form, event.submitter);
    if (!submitButton || submitButton.disabled) {
      return;
    }

    originalLabel = submitButton.tagName === 'INPUT'
      ? submitButton.value
      : submitButton.textContent;

    if (!toTrimmedString(submitButton.getAttribute('data-initial-label'))) {
      submitButton.setAttribute('data-initial-label', originalLabel);
    }

    loadingLabel = getLoadingLabel(form, submitButton);
    setButtonLabel(submitButton, loadingLabel);
    submitButton.disabled = true;
    submitButton.setAttribute('aria-busy', 'true');
  }

  function initSignupSubmitState() {
    document.addEventListener('submit', handleSignupSubmit, true);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSignupSubmitState);
    return;
  }

  initSignupSubmitState();
})();
