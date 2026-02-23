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

  function hideDeleteAlert() {
    if (!hasDeleteModal) {
      return;
    }

    pendingDeleteForm = null;
    deleteAlert.classList.add('hidden');
    deleteAlert.classList.remove('flex');
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
