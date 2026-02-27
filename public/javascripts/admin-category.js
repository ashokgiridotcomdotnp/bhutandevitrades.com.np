(function () {
  function getPageData() {
    var dataScript = document.getElementById('admin-category-page-data');
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
  var addProductSubcategoryOptions = pageData && typeof pageData === 'object' && Array.isArray(pageData.addProductSubcategoryOptions)
    ? pageData.addProductSubcategoryOptions
    : [];
  var deleteAlert = document.getElementById('delete-alert');
  var deleteAlertTitle = document.getElementById('delete-alert-title');
  var deleteAlertMessage = document.getElementById('delete-alert-message');
  var deleteAlertCancel = document.getElementById('delete-alert-cancel');
  var deleteAlertConfirm = document.getElementById('delete-alert-confirm');
  var pendingDeleteForm = null;
  var statusTooltip = document.querySelector('[data-status-tooltip]');
  var addSubcategoryPicker = document.querySelector('[data-add-subcategory-picker]');
  var addSubcategoryCustomInput = document.querySelector('[data-add-subcategory-custom-input]');
  var addFormMrpInput = document.querySelector('[data-add-form-mrp-input]');
  var addFormDiscountInput = document.querySelector('[data-add-form-discount-input]');
  var addFormPricePreview = document.querySelector('[data-add-form-price-preview]');
  var addFormPriceOriginal = document.querySelector('[data-add-form-price-original]');
  var addFormPriceFinal = document.querySelector('[data-add-form-price-final]');
  var createProductForm = document.getElementById('category-product-create-form');
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
    var preview = inputId ? document.querySelector('[data-image-preview-for="' + inputId + '"]') : null;
    var objectUrl = '';

    if (!inputId || !label) {
      return;
    }

    function clearPreview() {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = '';
      }

      if (preview) {
        preview.src = '';
        preview.classList.add('hidden');
      }
    }

    function syncFileName() {
      var defaultText = label.getAttribute('data-file-default-text') || 'No photo chosen';
      var selectedFile = input.files && input.files.length ? input.files[0] : null;
      var fileName = selectedFile ? selectedFile.name : '';
      label.textContent = fileName || defaultText;

      if (!preview) {
        return;
      }

      if (!selectedFile || !selectedFile.type || selectedFile.type.indexOf('image/') !== 0) {
        clearPreview();
        return;
      }

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }

      objectUrl = URL.createObjectURL(selectedFile);
      preview.src = objectUrl;
      preview.classList.remove('hidden');
    }

    input.addEventListener('change', syncFileName);
    syncFileName();
  }

  function parsePositiveNumber(value) {
    var cleanedValue = String(value || '').replace(/,/g, '').trim();
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

  function syncFormPricePreview(form) {
    if (!form) {
      return;
    }

    var mrpInput = form.querySelector('[data-form-mrp-input]');
    var discountInput = form.querySelector('[data-form-discount-input]');
    var previewRoot = form.querySelector('[data-form-price-preview]');
    var previewOriginal = form.querySelector('[data-form-price-original]');
    var previewFinal = form.querySelector('[data-form-price-final]');

    if (!mrpInput || !discountInput || !previewRoot || !previewOriginal || !previewFinal) {
      return;
    }

    var mrpValue = parsePositiveNumber(mrpInput.value);
    var discountValue = parsePositiveNumber(discountInput.value);

    if (!Number.isFinite(mrpValue)) {
      previewRoot.classList.add('hidden');
      previewOriginal.classList.add('hidden');
      previewOriginal.textContent = '';
      previewFinal.textContent = '';
      return;
    }

    if (!Number.isFinite(discountValue)) {
      discountValue = 0;
    }

    discountValue = Math.min(Math.max(discountValue, 0), 100);
    var discountedValue = mrpValue * ((100 - discountValue) / 100);

    previewRoot.classList.remove('hidden');
    previewFinal.textContent = formatNpr(discountedValue);

    if (discountValue > 0 && discountedValue < mrpValue) {
      previewOriginal.classList.remove('hidden');
      previewOriginal.textContent = formatNpr(mrpValue);
      return;
    }

    previewOriginal.classList.add('hidden');
    previewOriginal.textContent = '';
  }

  function bindFormPricePreview(form) {
    if (!form) {
      return;
    }

    var mrpInput = form.querySelector('[data-form-mrp-input]');
    var discountInput = form.querySelector('[data-form-discount-input]');

    if (!mrpInput || !discountInput) {
      return;
    }

    function handlePriceInput() {
      syncFormPricePreview(form);
    }

    mrpInput.addEventListener('input', handlePriceInput);
    discountInput.addEventListener('input', handlePriceInput);
    syncFormPricePreview(form);
  }

  function enableAddSubcategoryPicker() {
    if (addSubcategoryPicker) {
      addSubcategoryPicker.disabled = false;
      addSubcategoryPicker.required = true;
      addSubcategoryPicker.classList.remove('hidden');
    }

    if (addSubcategoryCustomInput) {
      addSubcategoryCustomInput.disabled = true;
      addSubcategoryCustomInput.required = false;
      addSubcategoryCustomInput.value = '';
      addSubcategoryCustomInput.classList.add('hidden');
    }
  }

  function enableAddSubcategoryCustomInput() {
    if (addSubcategoryPicker) {
      addSubcategoryPicker.disabled = true;
      addSubcategoryPicker.required = false;
      addSubcategoryPicker.value = '';
      addSubcategoryPicker.classList.add('hidden');
    }

    if (addSubcategoryCustomInput) {
      addSubcategoryCustomInput.disabled = false;
      addSubcategoryCustomInput.required = true;
      addSubcategoryCustomInput.classList.remove('hidden');
    }
  }

  function syncAddSubcategoryInputMode() {
    if (!addSubcategoryPicker || !addSubcategoryCustomInput) {
      return;
    }

    if (Array.isArray(addProductSubcategoryOptions) && addProductSubcategoryOptions.length > 0) {
      enableAddSubcategoryPicker();
      return;
    }

    enableAddSubcategoryCustomInput();
  }

  function syncAddFormPricePreview() {
    if (!addFormMrpInput || !addFormDiscountInput || !addFormPricePreview || !addFormPriceOriginal || !addFormPriceFinal) {
      return;
    }

    var mrpValue = parsePositiveNumber(addFormMrpInput.value);
    var discountValue = parsePositiveNumber(addFormDiscountInput.value);

    if (!Number.isFinite(mrpValue)) {
      addFormPricePreview.classList.add('hidden');
      addFormPriceOriginal.classList.add('hidden');
      addFormPriceOriginal.textContent = '';
      addFormPriceFinal.textContent = '';
      return;
    }

    if (!Number.isFinite(discountValue)) {
      discountValue = 0;
    }

    discountValue = Math.min(Math.max(discountValue, 0), 100);
    var discountedValue = mrpValue * ((100 - discountValue) / 100);

    addFormPricePreview.classList.remove('hidden');
    addFormPriceFinal.textContent = formatNpr(discountedValue);

    if (discountValue > 0 && discountedValue < mrpValue) {
      addFormPriceOriginal.classList.remove('hidden');
      addFormPriceOriginal.textContent = formatNpr(mrpValue);
      return;
    }

    addFormPriceOriginal.classList.add('hidden');
    addFormPriceOriginal.textContent = '';
  }

  function getCardElements(cardId) {
    return {
      form: document.querySelector('[data-edit-form="' + cardId + '"]'),
      view: document.querySelector('[data-view-panel="' + cardId + '"]'),
      editRow: document.querySelector('[data-edit-row="' + cardId + '"]'),
    };
  }

  function toggleEdit(cardId, isEditMode) {
    var card = getCardElements(cardId);
    if (!card.form || !card.view) {
      return;
    }

    if (isEditMode) {
      card.view.classList.add('hidden');
      if (card.editRow) {
        card.editRow.classList.remove('hidden');
      }
      card.form.classList.remove('hidden');
      syncFormPricePreview(card.form);
      var firstInput = card.form.querySelector('input[type="text"]');
      if (firstInput) {
        firstInput.focus();
        firstInput.select();
      }
      return;
    }

    card.form.classList.add('hidden');
    if (card.editRow) {
      card.editRow.classList.add('hidden');
    }
    card.view.classList.remove('hidden');
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

  function hideDeleteAlert() {
    if (!hasDeleteModal) {
      return;
    }

    pendingDeleteForm = null;
    deleteAlert.classList.add('hidden');
    deleteAlert.classList.remove('flex');
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

  function clearFormFileInputs(form) {
    if (!form) {
      return;
    }

    form.querySelectorAll('[data-file-input]').forEach(function (input) {
      input.value = '';
      input.dispatchEvent(new Event('change'));
    });
  }

  async function submitProductFormWithoutReload(form, activeSubmitter, options) {
    var response = null;
    var result = null;
    var finalUrl = null;
    var hasError = false;
    var message = '';
    var successFallbackMessage = options && options.successFallbackMessage
      ? options.successFallbackMessage
      : 'Product saved successfully.';
    var errorFallbackMessage = options && options.errorFallbackMessage
      ? options.errorFallbackMessage
      : 'Could not save product. Please try again.';

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
          message = result.message || result.error || errorFallbackMessage;
        }
        showToast('error', message);
        return;
      }

      message = result.message || successFallbackMessage;
      showToast('success', message);

      if (options && typeof options.onSuccess === 'function') {
        options.onSuccess(form);
      }
    } catch (error) {
      showToast('error', errorFallbackMessage);
    } finally {
      form.removeAttribute('data-is-submitting');
      setSubmitButtonState(form, false, null);
      setLoadingOverlay(false);
    }
  }

  document.querySelectorAll('[data-edit-toggle]').forEach(function (button) {
    button.addEventListener('click', function () {
      toggleEdit(button.getAttribute('data-edit-toggle'), true);
    });
  });

  document.querySelectorAll('[data-edit-cancel]').forEach(function (button) {
    button.addEventListener('click', function () {
      toggleEdit(button.getAttribute('data-edit-cancel'), false);
    });
  });

  document.querySelectorAll('form[data-edit-form]').forEach(bindFormPricePreview);
  document.querySelectorAll('[data-file-input]').forEach(bindFileInputLabel);
  syncAddSubcategoryInputMode();
  syncAddFormPricePreview();
  clearAdminFlashQueryParams();

  if (statusTooltip) {
    setTimeout(function () {
      statusTooltip.remove();
    }, 2000);
  }

  if (addFormMrpInput) {
    addFormMrpInput.addEventListener('input', syncAddFormPricePreview);
  }

  if (addFormDiscountInput) {
    addFormDiscountInput.addEventListener('input', syncAddFormPricePreview);
  }

  var helmetCoverageSelect = document.querySelector('[data-helmet-coverage-select]');
  var helmetCoverageButtons = Array.prototype.slice.call(document.querySelectorAll('[data-helmet-coverage-option]'));

  function syncHelmetCoverageButtons() {
    if (!helmetCoverageSelect || !helmetCoverageButtons.length) {
      return;
    }

    var selectedValue = String(helmetCoverageSelect.value || '').trim();
    helmetCoverageButtons.forEach(function (button) {
      var optionValue = button.getAttribute('data-helmet-coverage-option');
      var isActive = optionValue === selectedValue;

      button.classList.toggle('bg-blue-600', isActive);
      button.classList.toggle('text-white', isActive);
      button.classList.toggle('shadow-sm', isActive);
      button.classList.toggle('text-slate-700', !isActive);
    });
  }

  if (helmetCoverageSelect && helmetCoverageButtons.length) {
    helmetCoverageButtons.forEach(function (button) {
      button.addEventListener('click', function () {
        var optionValue = button.getAttribute('data-helmet-coverage-option') || '';
        helmetCoverageSelect.value = optionValue;
        syncHelmetCoverageButtons();
      });
    });

    helmetCoverageSelect.addEventListener('change', syncHelmetCoverageButtons);
    syncHelmetCoverageButtons();
  }

  if (createProductForm) {
    createProductForm.setAttribute('data-skip-global-loading', 'true');
    createProductForm.addEventListener('submit', function (event) {
      var submitter = event.submitter && event.submitter.form === createProductForm
        ? event.submitter
        : null;

      event.preventDefault();
      submitProductFormWithoutReload(createProductForm, submitter, {
        successFallbackMessage: 'Product saved successfully.',
        errorFallbackMessage: 'Could not save product right now. Please try again.',
        onSuccess: function () {
          createProductForm.reset();
          syncAddSubcategoryInputMode();
          syncAddFormPricePreview();
          clearFormFileInputs(createProductForm);
          if (helmetCoverageSelect) {
            helmetCoverageSelect.value = '';
            syncHelmetCoverageButtons();
          }
        },
      });
    });
  }

  document.querySelectorAll('form[data-edit-form]').forEach(function (editForm) {
    editForm.setAttribute('data-skip-global-loading', 'true');
    editForm.addEventListener('submit', function (event) {
      var submitter = event.submitter && event.submitter.form === editForm
        ? event.submitter
        : null;

      event.preventDefault();
      submitProductFormWithoutReload(editForm, submitter, {
        successFallbackMessage: 'Product updated successfully.',
        errorFallbackMessage: 'Could not update product right now. Please try again.',
        onSuccess: function () {
          clearFormFileInputs(editForm);
        },
      });
    });
  });

  document.querySelectorAll('[data-delete-trigger]').forEach(function (button) {
    button.addEventListener('click', function () {
      var cardId = button.getAttribute('data-delete-trigger');
      var form = document.querySelector('[data-delete-form="' + cardId + '"]');
      if (!form) {
        return;
      }

      showDeleteAlert(
        form,
        'Delete Product',
        'Delete "' + (button.getAttribute('data-product-name') || 'this product') + '"? This action cannot be undone.'
      );
    });
  });

  document.querySelectorAll('[data-delete-category-trigger]').forEach(function (button) {
    button.addEventListener('click', function () {
      var categoryKey = button.getAttribute('data-delete-category-trigger');
      var categoryName = button.getAttribute('data-category-name') || 'this category';
      var form = document.querySelector('[data-delete-category-form="' + categoryKey + '"]');
      if (!form) {
        return;
      }

      showDeleteAlert(
        form,
        'Delete Category',
        'Delete category "' + categoryName + '" and all products inside it? This action cannot be undone.'
      );
    });
  });

  async function submitDeleteFormAsync(form) {
    var response = null;
    var result = null;
    var productId = null;
    var categoryName = null;

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
        productId = form.querySelector('input[name="productId"]')?.value;
        categoryName = form.querySelector('input[name="categoryName"]')?.value;

        if (productId) {
          // Find and remove the row
          var viewRow = document.querySelector('[data-view-panel="' + productId + '"]');
          var editRow = document.querySelector('[data-edit-row="' + productId + '"]');
          if (viewRow) {
            viewRow.remove();
          }
          if (editRow) {
            editRow.remove();
          }
        }

        if (categoryName) {
          // Redirect to admin dashboard after deleting category
          setTimeout(function () {
            window.location.href = '/admin';
          }, 800);
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
})();
