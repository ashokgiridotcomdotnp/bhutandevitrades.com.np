(function () {
    'use strict';

    function showToast(message, type) {
        if (typeof bdShowToast === 'function') {
            bdShowToast(message, type);
        } else {
            window.alert(message);
        }
    }

    function setLoadingOverlay(show) {
        var overlay = document.getElementById('bd-page-loading');
        if (overlay) {
            overlay.classList.toggle('hidden', !show);
        }
    }

    function setButtonLoading(button, loading) {
        var btnText = button.querySelector('.btn-text');
        var btnLoading = button.querySelector('.btn-loading');
        if (btnText) btnText.classList.toggle('hidden', loading);
        if (btnLoading) btnLoading.classList.toggle('hidden', !loading);
        button.disabled = loading;
    }

    function showFormError(message) {
        var errorDiv = document.getElementById('password-error');
        if (errorDiv) {
            errorDiv.textContent = message;
            errorDiv.classList.remove('hidden');
        }
    }

    function hideFormError() {
        var errorDiv = document.getElementById('password-error');
        if (errorDiv) {
            errorDiv.classList.add('hidden');
        }
    }

    function validatePassword(password) {
        var minLength = 8;
        var hasUpper = /[A-Z]/.test(password);
        var hasLower = /[a-z]/.test(password);
        var hasNumber = /\d/.test(password);
        var hasSpecial = /[@$!%*?&]/.test(password);

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
        var formData = new FormData(form);
        var currentPassword = String(formData.get('currentPassword') || '');
        var newPassword = String(formData.get('newPassword') || '');
        var confirmPassword = String(formData.get('confirmPassword') || '');
        var submitBtn = document.getElementById('submit-btn');

        hideFormError();

        // Client-side validation
        if (!currentPassword) {
            showFormError('Current password is required');
            return;
        }

        var passwordError = validatePassword(newPassword);
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
            var response = await fetch(form.action, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Requested-With': 'XMLHttpRequest',
                },
                body: new URLSearchParams({
                    currentPassword: currentPassword,
                    newPassword: newPassword,
                    confirmPassword: confirmPassword,
                }),
                credentials: 'same-origin',
            });

            var result = await response.json();

            if (result.success) {
                showToast(result.message || 'Password updated successfully', 'success');
                form.reset();
                // Redirect to login after successful password change
                if (result.redirectUrl) {
                    setTimeout(function () {
                        window.location.href = result.redirectUrl;
                    }, 1500);
                }
            } else {
                showFormError(result.message || 'Failed to update password');
                showToast(result.message || 'Failed to update password', 'error');
            }
        } catch (error) {
            console.error('Password update error:', error);
            showFormError('An error occurred. Please try again.');
            showToast('An error occurred. Please try again.', 'error');
        } finally {
            setButtonLoading(submitBtn, false);
            setLoadingOverlay(false);
        }
    }

    function initPasswordForm() {
        var form = document.getElementById('admin-password-form');
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
