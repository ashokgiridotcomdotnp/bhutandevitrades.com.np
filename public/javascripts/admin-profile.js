(function () {
    'use strict';

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

    function showToast(message, type) {
        if (typeof bdShowToast === 'function') {
            bdShowToast(message, type);
        } else {
            window.alert(message);
        }
    }

    function setLoadingOverlay(show) {
        let overlay = document.getElementById('bd-page-loading');
        if (overlay) {
            overlay.classList.toggle('hidden', !show);
        }
    }

    function setButtonLoading(button, loading) {
        let btnText = button.querySelector('.btn-text');
        let btnLoading = button.querySelector('.btn-loading');
        if (btnText) btnText.classList.toggle('hidden', loading);
        if (btnLoading) btnLoading.classList.toggle('hidden', !loading);
        button.disabled = loading;
    }

    function showFormError(message) {
        let errorDiv = document.getElementById('password-error');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.classList.remove('hidden');
        }
    }

    function hideFormError() {
        let errorDiv = document.getElementById('password-error');
        if (errorDiv) {
            errorDiv.classList.add('hidden');
        }
    }

    function validatePassword(password) {
        let minLength = 8;
        let hasUpper = /[A-Z]/.test(password);
        let hasLower = /[a-z]/.test(password);
        let hasNumber = /\d/.test(password);
        let hasSpecial = /[@$!%*?&]/.test(password);

        if (password.length < minLength) {
            return 'Password must be at least 8 characters long';
        }
        if (!hasUpper) {
            return 'Password must contain at least one uppercase letter';
        }
        if (!hasLower) {
            return 'Password must contain at least one lowercase letter';
        }
        if (!hasNumber) {
            return 'Password must contain at least one number';
        }
        if (!hasSpecial) {
            return 'Password must contain at least one special character (@$!%*?&)';
        }
        return null;
    }

    async function submitPasswordFormAsync(form) {
        let formData = new FormData(form);
        let currentPassword = String(formData.get('currentPassword') || '');
        let newPassword = String(formData.get('newPassword') || '');
        let confirmPassword = String(formData.get('confirmPassword') || '');
        let submitBtn = document.getElementById('submit-btn');

        hideFormError();

        // Client-side validation
        if (!currentPassword) {
            showFormError('Current password is required');
            return;
        }

        let passwordError = validatePassword(newPassword);
        if (passwordError) {
            showFormError(passwordError);
            return;
        }

        if (newPassword !== confirmPassword) {
            showFormError('Passwords do not match');
            return;
        }

        if (newPassword === currentPassword) {
            showFormError('New password must be different from current password');
            return;
        }

        setButtonLoading(submitBtn, true);
        setLoadingOverlay(true);

        try {
            let fetchResult = await fetchAdminJson(form.action, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json',
                },
                body: new URLSearchParams({
                    currentPassword: currentPassword,
                    newPassword: newPassword,
                    confirmPassword: confirmPassword,
                }),
                credentials: 'same-origin',
            });

            if (fetchResult.redirectedToLogin) {
                return;
            }

            let result = fetchResult.payload;

            if (!result || typeof result !== 'object') {
                showFormError('Unexpected server response. Please refresh and try again.');
                showToast('Unexpected server response. Please refresh and try again.', 'error');
                return;
            }

            if (isSuccessResponsePayload(result)) {
                showToast(buildResponseMessage(result, 'Password updated successfully'), 'success');
                form.reset();
                // Redirect to login after successful password change
                if (result.redirectUrl) {
                    setTimeout(function () {
                        window.location.href = result.redirectUrl;
                    }, 1500);
                }
            } else {
                showFormError(buildResponseMessage(result, 'Failed to update password'));
                showToast(buildResponseMessage(result, 'Failed to update password'), 'error');
            }
        } catch (error) {
            showFormError('An error occurred. Please try again.');
            showToast('An error occurred. Please try again.', 'error');
        } finally {
            setButtonLoading(submitBtn, false);
            setLoadingOverlay(false);
        }
    }

    function initPasswordForm() {
        let form = document.getElementById('admin-password-form');
        if (!form) return;

        form.addEventListener('submit', function (event) {
            event.preventDefault();
            submitPasswordFormAsync(form);
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initPasswordForm);
    } else {
        initPasswordForm();
    }
})();
