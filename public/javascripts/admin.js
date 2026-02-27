(function () {
  function getPageData() {
    var dataScript = document.getElementById('admin-page-data');
    if (!dataScript) {
      return {};
    }

    try {
      return JSON.parse(dataScript.textContent || '{}');
    } catch (error) {
      return {};
    }
  }

  var pageData = getPageData();
  var subcategoryOptionsByCategory = pageData && typeof pageData === 'object' && pageData.subcategoryOptionsByCategory
    ? pageData.subcategoryOptionsByCategory
    : {};
  var deleteAlert = document.getElementById('delete-alert');
  var deleteAlertTitle = document.getElementById('delete-alert-title');
  var deleteAlertMessage = document.getElementById('delete-alert-message');
  var deleteAlertCancel = document.getElementById('delete-alert-cancel');
  var deleteAlertConfirm = document.getElementById('delete-alert-confirm');
  var pendingDeleteForm = null;
  var quickAddCategoryInput = document.querySelector('[data-product-category-input]');
  var quickAddSubcategoryPicker = document.querySelector('[data-product-subcategory-picker]');
  var quickAddSubcategoryCustomInput = document.querySelector('[data-product-subcategory-custom-input]');
  var helmetCoverageContainer = document.querySelector('[data-helmet-coverage-container]');
  var helmetCoveragePicker = document.querySelector('[data-helmet-coverage-picker]');
  var quickAddMrpInput = document.querySelector('[data-product-mrp-input]');
  var quickAddDiscountInput = document.querySelector('[data-product-discount-input]');
  var quickAddPricePreview = document.querySelector('[data-product-price-preview]');
  var quickAddPriceOriginal = document.querySelector('[data-product-price-original]');
  var quickAddPriceFinal = document.querySelector('[data-product-price-final]');
  var quickAddProductForm = document.querySelector('form[action="/admin/products"][enctype="multipart/form-data"]');
  var statusTooltip = document.querySelector('[data-status-tooltip]');
  var hasDeleteModal = Boolean(deleteAlert && deleteAlertTitle && deleteAlertMessage && deleteAlertCancel && deleteAlertConfirm);

  function clearAdminFlashQueryParams() {
    if (!window.history || typeof window.history.replaceState !== 'function') {
      return;
    }

    var currentUrl = new URL(window.location.href);
    var hasStatus = currentUrl.searchParams.has('status');
    var hasError = currentUrl.searchParams.has('error');

    if (!hasStatus && !hasError) {
      return;
    }

    currentUrl.searchParams.delete('status');
    currentUrl.searchParams.delete('error');

    var nextQuery = currentUrl.searchParams.toString();
    var nextUrl = currentUrl.pathname + (nextQuery ? '?' + nextQuery : '') + currentUrl.hash;
    window.history.replaceState({}, document.title, nextUrl);
  }

  function bindFileInputLabel(input) {
    var inputId = input && input.id ? input.id : '';
    var label = inputId ? document.querySelector('[data-file-name-for="' + inputId + '"]') : null;

    if (!inputId || !label) {
      return;
    }

    function syncFileName() {
      var defaultText = label.getAttribute('data-file-default-text') || 'No photo chosen';
      var fileName = input.files && input.files.length ? input.files[0].name : '';
      label.textContent = fileName || defaultText;
    }

    input.addEventListener('change', syncFileName);
    syncFileName();
  }

  function normalizeCategoryKey(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function getCategorySubcategoryOptions(categoryName) {
    var categoryKey = normalizeCategoryKey(categoryName);
    var options = categoryKey ? subcategoryOptionsByCategory[categoryKey] : [];
    return Array.isArray(options) ? options : [];
  }

  function enableSubcategorySelect() {
    if (quickAddSubcategoryPicker) {
      quickAddSubcategoryPicker.disabled = false;
      quickAddSubcategoryPicker.required = true;
      quickAddSubcategoryPicker.classList.remove('hidden');
    }

    if (quickAddSubcategoryCustomInput) {
      quickAddSubcategoryCustomInput.disabled = true;
      quickAddSubcategoryCustomInput.required = false;
      quickAddSubcategoryCustomInput.value = '';
      quickAddSubcategoryCustomInput.classList.add('hidden');
    }
  }

  function enableCustomSubcategoryInput() {
    if (quickAddSubcategoryPicker) {
      quickAddSubcategoryPicker.disabled = true;
      quickAddSubcategoryPicker.required = false;
      quickAddSubcategoryPicker.value = '';
      quickAddSubcategoryPicker.classList.add('hidden');
    }

    if (quickAddSubcategoryCustomInput) {
      quickAddSubcategoryCustomInput.disabled = false;
      quickAddSubcategoryCustomInput.required = true;
      quickAddSubcategoryCustomInput.classList.remove('hidden');
    }
  }

  function resetSubcategoryInputs() {
    if (quickAddSubcategoryPicker) {
      quickAddSubcategoryPicker.innerHTML = '';
      var placeholderOption = document.createElement('option');
      placeholderOption.value = '';
      placeholderOption.textContent = 'Select category first';
      quickAddSubcategoryPicker.appendChild(placeholderOption);
      quickAddSubcategoryPicker.disabled = true;
      quickAddSubcategoryPicker.required = false;
      quickAddSubcategoryPicker.classList.remove('hidden');
    }

    if (quickAddSubcategoryCustomInput) {
      quickAddSubcategoryCustomInput.disabled = true;
      quickAddSubcategoryCustomInput.required = false;
      quickAddSubcategoryCustomInput.value = '';
      quickAddSubcategoryCustomInput.classList.add('hidden');
    }
  }

  function syncQuickAddSubcategoryOptions() {
    if (!quickAddCategoryInput || !quickAddSubcategoryPicker) {
      return;
    }

    if (!normalizeCategoryKey(quickAddCategoryInput.value)) {
      resetSubcategoryInputs();
      return;
    }

    var options = getCategorySubcategoryOptions(quickAddCategoryInput.value);
    var previousValue = String(quickAddSubcategoryPicker.value || '').trim();
    var hasPreviousValue = false;

    quickAddSubcategoryPicker.innerHTML = '';

    var placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = options.length ? 'Select subcategory' : 'No subcategory available';
    quickAddSubcategoryPicker.appendChild(placeholderOption);

    options.forEach(function (option) {
      var optionElement = document.createElement('option');
      optionElement.value = option;
      optionElement.textContent = option;

      if (option === previousValue) {
        hasPreviousValue = true;
        optionElement.selected = true;
      }

      quickAddSubcategoryPicker.appendChild(optionElement);
    });

    if (!hasPreviousValue) {
      quickAddSubcategoryPicker.value = '';
    }

    if (options.length > 0) {
      enableSubcategorySelect();
      return;
    }

    enableCustomSubcategoryInput();
  }

  function parsePositiveNumber(value) {
    var cleanedValue = String(value || '')
      .replace(/,/g, '')
      .trim();
    var parsedValue = Number(cleanedValue);

    if (!cleanedValue || !Number.isFinite(parsedValue) || parsedValue < 0) {
      return NaN;
    }

    return parsedValue;
  }

  function formatNpr(value) {
    var normalizedValue = Math.round(value * 100) / 100;
    var hasDecimal = Math.abs(normalizedValue % 1) > 0;

    return 'NPR ' + normalizedValue.toLocaleString('en-US', {
      minimumFractionDigits: hasDecimal ? 2 : 0,
      maximumFractionDigits: 2,
    });
  }

  function syncQuickAddPricePreview() {
    if (!quickAddMrpInput || !quickAddDiscountInput || !quickAddPricePreview || !quickAddPriceFinal || !quickAddPriceOriginal) {
      return;
    }

    var mrpValue = parsePositiveNumber(quickAddMrpInput.value);
    var discountValue = parsePositiveNumber(quickAddDiscountInput.value);

    if (!Number.isFinite(mrpValue)) {
      quickAddPricePreview.classList.add('hidden');
      quickAddPriceOriginal.classList.add('hidden');
      quickAddPriceOriginal.textContent = '';
      quickAddPriceFinal.textContent = '';
      return;
    }

    if (!Number.isFinite(discountValue)) {
      discountValue = 0;
    }

    discountValue = Math.min(Math.max(discountValue, 0), 100);
    var discountedValue = mrpValue * ((100 - discountValue) / 100);

    quickAddPricePreview.classList.remove('hidden');
    quickAddPriceFinal.textContent = formatNpr(discountedValue);

    if (discountValue > 0 && discountedValue < mrpValue) {
      quickAddPriceOriginal.classList.remove('hidden');
      quickAddPriceOriginal.textContent = formatNpr(mrpValue);
      return;
    }

    quickAddPriceOriginal.classList.add('hidden');
    quickAddPriceOriginal.textContent = '';
  }

  function syncQuickAddCategoryFields() {
    if (!quickAddCategoryInput) {
      return;
    }

    var isHelmetCategory = normalizeCategoryKey(quickAddCategoryInput.value) === 'helmet';

    if (!isHelmetCategory && helmetCoveragePicker) {
      helmetCoveragePicker.value = '';
    }

    if (helmetCoveragePicker) {
      helmetCoveragePicker.required = isHelmetCategory;
    }

    if (helmetCoverageContainer) {
      helmetCoverageContainer.classList.toggle('hidden', !isHelmetCategory);
    }

    syncQuickAddSubcategoryOptions();
  }

  function showDeleteAlert(form, title, message) {
    if (!form) {
      return;
    }

    if (!hasDeleteModal) {
      form.submit();
      return;
    }

    pendingDeleteForm = form;
    deleteAlertTitle.textContent = title || 'Delete';
    deleteAlertMessage.textContent = message || 'Are you sure? This action cannot be undone.';
    deleteAlert.classList.remove('hidden');
    deleteAlert.classList.add('flex');
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

  function extractAlertMessageFromHtml(htmlText) {
    var parser = null;
    var doc = null;
    var errorAlert = null;
    var warningAlert = null;
    var successAlert = null;
    var extractText = function (node) {
      return String(node && node.textContent ? node.textContent : '').replace(/\s+/g, ' ').trim();
    };

    if (!htmlText || typeof DOMParser !== 'function') {
      return { type: '', message: '' };
    }

    parser = new DOMParser();
    doc = parser.parseFromString(htmlText, 'text/html');
    errorAlert = doc.querySelector('[data-error-alert]');
    if (errorAlert) {
      return {
        type: 'error',
        message: extractText(errorAlert),
      };
    }

    warningAlert = doc.querySelector('[data-warning-alert]');
    if (warningAlert) {
      return {
        type: 'warning',
        message: extractText(warningAlert),
      };
    }

    successAlert = doc.querySelector('[data-success-alert]');
    if (successAlert) {
      return {
        type: 'success',
        message: extractText(successAlert),
      };
    }

    return { type: '', message: '' };
  }

  function setSubmitButtonState(form, isSubmitting, activeSubmitter) {
    var submitButtons = Array.prototype.slice.call(form.querySelectorAll('button[type="submit"]'));

    if (!submitButtons.length) {
      return;
    }

    submitButtons.forEach(function (button) {
      var defaultLabel = String(button.getAttribute('data-default-label') || '').trim();

      if (!defaultLabel) {
        defaultLabel = String(button.textContent || '').trim() || 'Save';
        button.setAttribute('data-default-label', defaultLabel);
      }

      button.disabled = Boolean(isSubmitting);
      button.textContent = isSubmitting && (!activeSubmitter || button === activeSubmitter)
        ? 'Saving...'
        : defaultLabel;
    });
  }

  function resetQuickAddProductForm() {
    if (!quickAddProductForm) {
      return;
    }

    quickAddProductForm.reset();
    syncQuickAddCategoryFields();
    syncQuickAddPricePreview();
    quickAddProductForm.querySelectorAll('[data-file-input]').forEach(function (input) {
      input.dispatchEvent(new Event('change'));
    });
  }

  async function submitQuickAddProductForm(form, activeSubmitter) {
    var response = null;
    var result = null;
    var finalUrl = null;
    var hasError = false;
    var message = '';

    if (!form || form.getAttribute('data-is-submitting') === '1') {
      return;
    }

    if (typeof form.reportValidity === 'function' && !form.reportValidity()) {
      return;
    }

    form.setAttribute('data-is-submitting', '1');
    setSubmitButtonState(form, true, activeSubmitter);
    setLoadingOverlay(true);

    try {
      response = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json',
        },
      });

      finalUrl = new URL(response.url, window.location.href);
      if (finalUrl.pathname === '/admin/login') {
        window.location.href = '/admin/login';
        return;
      }

      // Parse JSON response
      result = await response.json();
      hasError = !result.success;

      if (hasError) {
        // Handle validation errors (array of errors) or single error message
        if (result.errors && Array.isArray(result.errors) && result.errors.length > 0) {
          message = result.errors.map(function (err) { return err.message; }).join(', ');
        } else {
          message = result.message || result.error || 'Could not save product. Please try again.';
        }
        showToast('error', message);
        return;
      }

      message = result.message || 'Product saved successfully.';
      showToast('success', message);
      resetQuickAddProductForm();
    } catch (error) {
      showToast('error', 'Could not save product right now. Please try again.');
    } finally {
      form.removeAttribute('data-is-submitting');
      setSubmitButtonState(form, false, null);
      setLoadingOverlay(false);
    }
  }

  function hideDeleteAlert() {
    if (!hasDeleteModal) {
      return;
    }

    pendingDeleteForm = null;
    deleteAlert.classList.add('hidden');
    deleteAlert.classList.remove('flex');
  }

  async function submitDeleteFormAsync(form) {
    var response = null;
    var result = null;

    if (!form) {
      return;
    }

    setLoadingOverlay(true);

    try {
      response = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (response.url && response.url.indexOf('/admin/login') !== -1) {
        window.location.href = '/admin/login';
        return;
      }

      result = await response.json();

      if (result.success) {
        showToast('success', result.message || 'Deleted successfully');
        // Remove the deleted item from DOM
        var productId = form.querySelector('input[name="productId"]')?.value;
        var categoryName = form.querySelector('input[name="categoryName"]')?.value;
        if (productId) {
          var row = form.closest('tr');
          if (row) {
            row.remove();
          } else {
            // Try to find by data attribute
            var triggerBtn = document.querySelector('[data-delete-product-trigger="' + productId + '"]');
            if (triggerBtn) {
              var card = triggerBtn.closest('article') || triggerBtn.closest('tr');
              if (card) {
                card.remove();
              }
            }
          }
        }
        if (categoryName) {
          var categoryKey = categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          var categoryCard = document.querySelector('[data-delete-category-form="' + categoryKey + '"]')?.closest('article');
          if (categoryCard) {
            categoryCard.remove();
          }
        }
      } else {
        showToast('error', result.message || 'Failed to delete');
      }
    } catch (error) {
      showToast('error', 'Failed to delete. Please try again.');
    } finally {
      setLoadingOverlay(false);
      hideDeleteAlert();
    }
  }

  if (quickAddCategoryInput) {
    quickAddCategoryInput.addEventListener('change', syncQuickAddCategoryFields);
  }

  if (quickAddMrpInput) {
    quickAddMrpInput.addEventListener('input', syncQuickAddPricePreview);
  }

  if (quickAddDiscountInput) {
    quickAddDiscountInput.addEventListener('input', syncQuickAddPricePreview);
  }

  document.querySelectorAll('[data-file-input]').forEach(bindFileInputLabel);
  syncQuickAddCategoryFields();
  syncQuickAddPricePreview();
  clearAdminFlashQueryParams();

  if (statusTooltip) {
    setTimeout(function () {
      statusTooltip.remove();
    }, 2000);
  }

  document.querySelectorAll('[data-delete-category-trigger]').forEach(function (button) {
    button.addEventListener('click', function () {
      var categoryKey = button.getAttribute('data-delete-category-trigger');
      var categoryName = button.getAttribute('data-category-name') || 'this category';
      var form = document.querySelector('[data-delete-category-form="' + categoryKey + '"]');

      showDeleteAlert(
        form,
        'Delete Category',
        'Delete category "' + categoryName + '" and all products inside it? This action cannot be undone.'
      );
    });
  });

  document.querySelectorAll('[data-delete-product-trigger]').forEach(function (button) {
    button.addEventListener('click', function () {
      var productKey = button.getAttribute('data-delete-product-trigger');
      var productName = button.getAttribute('data-product-name') || 'this product';
      var form = document.querySelector('[data-delete-product-form="' + productKey + '"]');

      showDeleteAlert(
        form,
        'Delete Product',
        'Delete "' + productName + '"? This action cannot be undone.'
      );
    });
  });

  if (hasDeleteModal) {
    deleteAlertCancel.addEventListener('click', hideDeleteAlert);

    deleteAlertConfirm.addEventListener('click', function () {
      if (pendingDeleteForm) {
        submitDeleteFormAsync(pendingDeleteForm);
      }
    });

    deleteAlert.addEventListener('click', function (event) {
      if (event.target === deleteAlert) {
        hideDeleteAlert();
      }
    });
  }

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      hideDeleteAlert();
    }
  });

  if (quickAddProductForm) {
    quickAddProductForm.setAttribute('data-skip-global-loading', 'true');
    quickAddProductForm.addEventListener('submit', function (event) {
      var submitter = event.submitter && event.submitter.form === quickAddProductForm
        ? event.submitter
        : null;

      event.preventDefault();
      submitQuickAddProductForm(quickAddProductForm, submitter);
    });
  }

  // Handle category creation form async
  var categoryForm = document.querySelector('form[action="/admin/categories"]');
  if (categoryForm) {
    categoryForm.setAttribute('data-skip-global-loading', 'true');
    categoryForm.addEventListener('submit', function (event) {
      event.preventDefault();
      submitCategoryFormAsync(categoryForm);
    });
  }

  async function submitCategoryFormAsync(form) {
    var response = null;
    var result = null;

    if (!form || form.getAttribute('data-is-submitting') === '1') {
      return;
    }

    if (typeof form.reportValidity === 'function' && !form.reportValidity()) {
      return;
    }

    form.setAttribute('data-is-submitting', '1');
    setSubmitButtonState(form, true, null);
    setLoadingOverlay(true);

    try {
      response = await fetch(form.action, {
        method: 'POST',
        body: new FormData(form),
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (response.url && response.url.indexOf('/admin/login') !== -1) {
        window.location.href = '/admin/login';
        return;
      }

      result = await response.json();

      if (result.success) {
        showToast('success', result.message || 'Category saved successfully');
        form.reset();
        // Reload page after short delay to show new category
        setTimeout(function () {
          window.location.reload();
        }, 800);
      } else {
        showToast('error', result.message || 'Failed to save category');
      }
    } catch (error) {
      showToast('error', 'Failed to save category. Please try again.');
    } finally {
      form.removeAttribute('data-is-submitting');
      setSubmitButtonState(form, false, null);
      setLoadingOverlay(false);
    }
  }
})();
