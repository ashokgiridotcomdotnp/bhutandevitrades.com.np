(function () {
  function toTrimmedString(value) {
    return String(value || '').trim();
  }

  function getFormErrorNode(form) {
    if (!form || !form.parentNode) {
      return null;
    }

    return form.parentNode.querySelector('[data-signup-form-error]');
  }

  function setFormError(form, message) {
    let errorNode = getFormErrorNode(form);
    let normalizedMessage = toTrimmedString(message);

    if (!errorNode || !normalizedMessage) {
      return;
    }

    errorNode.textContent = normalizedMessage;
    errorNode.classList.remove('hidden');
  }

  function clearFormError(form) {
    let errorNode = getFormErrorNode(form);
    if (!errorNode) {
      return;
    }

    errorNode.textContent = '';
    errorNode.classList.add('hidden');
  }

  function resolveSubmitButton(form, submitter) {
    if (submitter && submitter.form === form) {
      return submitter;
    }

    return form.querySelector('button[type="submit"], input[type="submit"]');
  }

  function getLoadingLabel(form, submitButton) {
    let customLabel = submitButton ? toTrimmedString(submitButton.getAttribute('data-loading-label')) : '';

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

  function extractNumericLength(input) {
    let minLength = Number(input && input.getAttribute('minlength'));
    let maxLength = Number(input && input.getAttribute('maxlength'));

    if (Number.isFinite(minLength) && minLength > 0) {
      return Math.floor(minLength);
    }

    if (Number.isFinite(maxLength) && maxLength > 0) {
      return Math.floor(maxLength);
    }

    return 6;
  }

  function validateSignupForm(form) {
    let nameInput = form.querySelector('input[name="name"]');
    let emailInput = form.querySelector('input[name="email"]');
    let passwordInput = form.querySelector('input[name="password"]');
    let verificationCodeInput = form.querySelector('input[name="verificationCode"]');
    let name = toTrimmedString(nameInput && nameInput.value);
    let email = toTrimmedString(emailInput && emailInput.value).toLowerCase();
    let password = toTrimmedString(passwordInput && passwordInput.value);
    let verificationCode = toTrimmedString(verificationCodeInput && verificationCodeInput.value).replace(/\s+/g, '');
    let passwordMinLength = Number(passwordInput && passwordInput.getAttribute('minlength'));
    let passwordMaxLength = Number(passwordInput && passwordInput.getAttribute('maxlength'));
    let codeLength = extractNumericLength(verificationCodeInput);

    clearFormError(form);

    if (typeof form.reportValidity === 'function' && !form.reportValidity()) {
      let firstInvalidField = form.querySelector(':invalid');
      let invalidMessage = firstInvalidField && firstInvalidField.validationMessage
        ? String(firstInvalidField.validationMessage).trim()
        : 'Please complete all required fields correctly.';
      setFormError(form, invalidMessage);
      return false;
    }

    if (!name || name.length < 2) {
      setFormError(form, 'Please enter your full name.');
      if (nameInput && typeof nameInput.focus === 'function') {
        nameInput.focus();
      }
      return false;
    }

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setFormError(form, 'Please enter a valid email address.');
      if (emailInput && typeof emailInput.focus === 'function') {
        emailInput.focus();
      }
      return false;
    }

    if (passwordInput) {
      if (!password) {
        setFormError(form, 'Please enter a password.');
        if (typeof passwordInput.focus === 'function') {
          passwordInput.focus();
        }
        return false;
      }

      if (Number.isFinite(passwordMinLength) && password.length < passwordMinLength) {
        setFormError(form, 'Password must be at least ' + passwordMinLength + ' characters.');
        if (typeof passwordInput.focus === 'function') {
          passwordInput.focus();
        }
        return false;
      }

      if (Number.isFinite(passwordMaxLength) && password.length > passwordMaxLength) {
        setFormError(form, 'Password is too long.');
        if (typeof passwordInput.focus === 'function') {
          passwordInput.focus();
        }
        return false;
      }
    }

    if (verificationCodeInput) {
      if (!verificationCode || !new RegExp('^[0-9]{' + codeLength + '}$').test(verificationCode)) {
        setFormError(form, 'Please enter a valid ' + codeLength + '-digit verification code.');
        if (typeof verificationCodeInput.focus === 'function') {
          verificationCodeInput.focus();
        }
        return false;
      }
    }

    return true;
  }

  function handleSignupSubmit(event) {
    let form = event.target;
    let submitButton = null;
    let loadingLabel = '';
    let originalLabel = '';

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

    if (!validateSignupForm(form)) {
      event.preventDefault();
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
