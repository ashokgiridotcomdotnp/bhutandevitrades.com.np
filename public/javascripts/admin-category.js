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

  if (hasDeleteModal) {
    deleteAlertCancel.addEventListener('click', hideDeleteAlert);

    deleteAlertConfirm.addEventListener('click', function () {
      if (pendingDeleteForm) {
        pendingDeleteForm.submit();
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
