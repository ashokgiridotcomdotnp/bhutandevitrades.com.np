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
  var categoryManageForm = document.querySelector('[data-category-manage-form]');
  var managedProductsRoot = document.querySelector('[data-managed-products-root]');
  var managedCategoryName = managedProductsRoot
    ? String(managedProductsRoot.getAttribute('data-managed-category-name') || '').trim()
    : '';
  var managedProductCountStat = document.querySelector('[data-managed-product-count-stat]');
  var managedProductCountBadge = document.querySelector('[data-managed-product-count-badge]');
  var managedProductsEmptyState = document.querySelector('[data-managed-products-empty]');
  var managedProductsTable = document.querySelector('[data-managed-products-table]');
  var managedProductsPagination = document.querySelector('[data-managed-products-pagination]');
  var managedTotalProductCount = 0;
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
    var preview = inputId ? document.querySelector('[data-image-preview-for="' + inputId + '"]') : null;
    var fileName = inputId ? document.querySelector('[data-file-name-for="' + inputId + '"]') : null;
    var defaultFileName = fileName
      ? String(fileName.getAttribute('data-file-default-text') || fileName.textContent || 'No file selected').trim()
      : '';
    var defaultPreviewSrc = preview
      ? String(preview.getAttribute('data-image-preview-default-src') || preview.getAttribute('src') || '').trim()
      : '';
    var objectUrl = '';

    if (!inputId || (!preview && !fileName)) {
      return;
    }

    function syncFileNameLabel(label) {
      if (!fileName) {
        return;
      }

      fileName.textContent = String(label || defaultFileName || 'No file selected').trim();
    }

    function syncDefaultPreview() {
      if (!preview) {
        return;
      }

      if (defaultPreviewSrc) {
        preview.src = defaultPreviewSrc;
        preview.classList.remove('hidden');
        return;
      }

      preview.src = '';
      preview.classList.add('hidden');
    }

    function clearPreview() {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = '';
      }

      syncDefaultPreview();
      syncFileNameLabel(defaultFileName);
    }

    function syncFileName() {
      var selectedFile = input.files && input.files.length ? input.files[0] : null;

      if (!selectedFile) {
        clearPreview();
        return;
      }

      syncFileNameLabel(selectedFile.name);

      if (!preview) {
        return;
      }

      if (!selectedFile.type || selectedFile.type.indexOf('image/') !== 0) {
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

  function parseCountText(value) {
    var matchedValue = String(value || '').match(/\d+/);
    return matchedValue ? Math.max(0, parseInt(matchedValue[0], 10) || 0) : 0;
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

  function closeOtherEditRows(activeCardId) {
    document.querySelectorAll('[data-edit-form]').forEach(function (form) {
      var formCardId = form ? form.getAttribute('data-edit-form') : '';

      if (!formCardId || formCardId === activeCardId) {
        return;
      }

      toggleEdit(formCardId, false);
    });
  }

  function toggleEdit(cardId, isEditMode) {
    var card = getCardElements(cardId);
    if (!card.form || !card.view) {
      return;
    }

    if (isEditMode) {
      closeOtherEditRows(cardId);
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

  function syncManagedProductsState(nextTotalCount) {
    var visibleCount = document.querySelectorAll('[data-view-panel]').length;
    var hasManagedProducts = visibleCount > 0;

    if (Number.isFinite(nextTotalCount)) {
      managedTotalProductCount = Math.max(0, nextTotalCount);
    }

    if (managedProductCountStat) {
      managedProductCountStat.textContent = String(managedTotalProductCount);
    }

    if (managedProductCountBadge) {
      managedProductCountBadge.textContent = managedTotalProductCount + ' product' + (managedTotalProductCount === 1 ? '' : 's');
    }

    if (managedProductsEmptyState) {
      managedProductsEmptyState.classList.toggle('hidden', hasManagedProducts);
    }

    if (managedProductsTable) {
      managedProductsTable.classList.toggle('hidden', !hasManagedProducts);
    }
  }

  managedTotalProductCount = managedProductCountStat
    ? parseCountText(managedProductCountStat.textContent)
    : (managedProductCountBadge ? parseCountText(managedProductCountBadge.textContent) : document.querySelectorAll('[data-view-panel]').length);

  function updateProductViewRow(productId, product) {
    var row = document.querySelector('[data-view-panel="' + productId + '"]');
    var editRow = document.querySelector('[data-edit-row="' + productId + '"]');
    var normalizedManagedCategoryName = String(managedCategoryName || '').trim().toLowerCase();
    var normalizedProductCategory = String(product && product.type || '').trim().toLowerCase();
    var originalPriceNode = null;
    var finalPriceNode = null;
    var discountNode = null;
    var imageNode = null;
    var stockValue = '';
    var hasDiscount = false;

    if (!row || !product) {
      return;
    }

    if (normalizedManagedCategoryName && normalizedProductCategory && normalizedManagedCategoryName !== normalizedProductCategory) {
      row.remove();
      if (editRow) {
        editRow.remove();
      }
      syncManagedProductsState(managedTotalProductCount - 1);
      return;
    }

    row.querySelectorAll('[data-product-name-text]').forEach(function (node) {
      node.textContent = product.name || 'Untitled Product';
    });
    row.querySelectorAll('[data-product-category-text]').forEach(function (node) {
      node.textContent = product.type || '';
    });
    row.querySelectorAll('[data-product-spec-text]').forEach(function (node) {
      node.textContent = product.spec || 'No description';
    });

    stockValue = product.quantity || product.quantity === 0 ? String(product.quantity) : '-';
    row.querySelectorAll('[data-product-stock-text]').forEach(function (node) {
      node.textContent = stockValue;
    });

    row.querySelectorAll('[data-product-image]').forEach(function (node) {
      node.src = product.image || '';
      node.alt = product.name || 'Product image';
    });

    row.querySelectorAll('[data-delete-trigger]').forEach(function (node) {
      node.setAttribute('data-product-name', product.name || '');
    });

    originalPriceNode = row.querySelector('[data-product-original-price-text]');
    finalPriceNode = row.querySelector('[data-product-final-price-text]');
    discountNode = row.querySelector('[data-product-discount-text]');
    hasDiscount = Boolean(product.originalPrice && product.originalPrice !== product.price);

    if (originalPriceNode) {
      originalPriceNode.textContent = hasDiscount ? String(product.originalPrice || '') : '';
      originalPriceNode.classList.toggle('hidden', !hasDiscount);
    }

    if (finalPriceNode) {
      finalPriceNode.textContent = product.price || '';
    }

    if (discountNode) {
      if (product.discountPercent) {
        discountNode.textContent = 'Discount: ' + product.discountPercent + '%';
        discountNode.classList.remove('hidden');
      } else {
        discountNode.textContent = '';
        discountNode.classList.add('hidden');
      }
    }

    if (editRow) {
      var currentImageInput = editRow.querySelector('input[name="currentImagePath"]');
      imageNode = editRow.querySelector('[data-image-preview-default-src]');
      if (imageNode) {
        imageNode.setAttribute('data-image-preview-default-src', product.image || '');
        imageNode.src = product.image || '';
        imageNode.alt = product.name || 'Product image';
      }
      if (currentImageInput) {
        currentImageInput.value = product.image || '';
      }
    }

    syncManagedProductsState();
    toggleEdit(productId, false);
  }

  async function submitCategoryManageFormAsync(form) {
    var response = null;
    var result = null;
    var formData = null;
    var urlEncodedData = null;

    if (!form || form.getAttribute('data-is-submitting') === '1') {
      return;
    }

    if (typeof form.reportValidity === 'function' && !form.reportValidity()) {
      return;
    }

    form.setAttribute('data-is-submitting', '1');
    setSubmitButtonState(form, true, null);
    setLoadingOverlay(true);

    formData = new FormData(form);
    urlEncodedData = new URLSearchParams(formData).toString();

    try {
      response = await fetch(form.action, {
        method: 'POST',
        body: urlEncodedData,
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (response.url && response.url.indexOf('/admin/login') !== -1) {
        window.location.href = '/admin/login';
        return;
      }

      result = await response.json();

      if (!result.success) {
        showToast('error', result.message || 'Failed to save category');
        return;
      }

      showToast('success', result.message || 'Category saved successfully');

      setTimeout(function () {
        var redirectPath = result && result.redirectPath ? String(result.redirectPath).trim() : '';

        if (redirectPath) {
          window.location.assign(redirectPath);
          return;
        }

        window.location.reload();
      }, 700);
    } catch (error) {
      showToast('error', 'Failed to save category. Please try again.');
    } finally {
      form.removeAttribute('data-is-submitting');
      setSubmitButtonState(form, false, null);
      setLoadingOverlay(false);
    }
  }

  function addProductToTable(product) {
    var tbody = document.querySelector('table tbody');
    if (!tbody || !product) {
      return;
    }

    var hasDiscount = product.originalPrice && product.originalPrice !== product.price;
    var stockValue = product.quantity || product.quantity === 0 ? product.quantity : '-';
    var rowId = product.id || '';
    var row = document.createElement('tr');
    row.className = 'align-top bg-white';
    row.setAttribute('data-view-panel', rowId);

    var priceHtml = '';
    if (hasDiscount) {
      priceHtml += '<p class="text-xs font-semibold text-red-600 line-through">' + (product.originalPrice || '') + '</p>';
    }
    priceHtml += '<p class="font-semibold text-emerald-700">' + (product.price || '') + '</p>';
    if (product.discountPercent) {
      priceHtml += '<p class="mt-1 text-xs font-semibold text-slate-600">Discount: ' + product.discountPercent + '%</p>';
    }

    row.innerHTML =
      '<td class="px-3 py-3">' +
      '<p class="text-base font-bold text-slate-900">' + (product.name || '') + '</p>' +
      '<p class="mt-1 font-mono text-xs text-slate-500">ID: ' + rowId + '</p>' +
      '</td>' +
      '<td class="px-3 py-3 text-slate-800">' + (product.type || '') + '</td>' +
      '<td class="px-3 py-3 text-slate-700">' + (product.spec || '') + '</td>' +
      '<td class="px-3 py-3 text-slate-800">' + priceHtml + '</td>' +
      '<td class="px-3 py-3 font-semibold text-slate-800">' + stockValue + '</td>' +
      '<td class="px-3 py-3">' +
      '<img src="' + (product.image || '') + '" alt="' + (product.name || '') + '" class="h-16 w-24 rounded-md border border-slate-200 bg-white object-cover" loading="lazy" />' +
      '</td>' +
      '<td class="px-3 py-3">' +
      '<div class="flex items-center justify-end gap-1.5">' +
      '<button type="button" title="Edit item" data-edit-toggle="' + rowId + '" class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100">&#9998;</button>' +
      '<button type="button" title="Delete item" data-delete-trigger="' + rowId + '" data-product-name="' + (product.name || '') + '" class="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-300 bg-red-50 text-red-700 hover:bg-red-100">&#128465;</button>' +
      '</div>' +
      '</td>';

    // Insert at the beginning of the tbody
    tbody.insertBefore(row, tbody.firstChild);

    // Add event listeners for the new buttons
    var editBtn = row.querySelector('[data-edit-toggle]');
    var deleteBtn = row.querySelector('[data-delete-trigger]');

    if (editBtn) {
      editBtn.addEventListener('click', function () {
        toggleEdit(rowId, true);
      });
    }

    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        var form = document.querySelector('[data-delete-form="' + rowId + '"]');
        if (form) {
          showDeleteAlert(form, 'Delete Product', 'Delete "' + (product.name || 'this product') + '"? This action cannot be undone.');
        }
      });
    }
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
        options.onSuccess(form, result);
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
  syncManagedProductsState();
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
        onSuccess: function (form, result) {
          createProductForm.reset();
          syncAddSubcategoryInputMode();
          syncAddFormPricePreview();
          clearFormFileInputs(createProductForm);
          // Add the new product to the table
          if (result && result.product) {
            addProductToTable(result.product);
          }
        },
      });
    });

    // Handle clear button
    var clearFormBtn = createProductForm.querySelector('[data-clear-form]');
    if (clearFormBtn) {
      clearFormBtn.addEventListener('click', function () {
        createProductForm.reset();
        syncAddSubcategoryInputMode();
        syncAddFormPricePreview();
        clearFormFileInputs(createProductForm);
      });
    }
  }

  if (categoryManageForm) {
    categoryManageForm.setAttribute('data-skip-global-loading', 'true');
    categoryManageForm.addEventListener('submit', function (event) {
      event.preventDefault();
      submitCategoryManageFormAsync(categoryManageForm);
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
        onSuccess: function (form, result) {
          clearFormFileInputs(editForm);
          if (result && result.productId && result.product) {
            updateProductViewRow(result.productId, result.product);
          }
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
      var urlEncodedData = new URLSearchParams(new FormData(form)).toString();
      response = await fetch(form.action, {
        method: 'POST',
        body: urlEncodedData,
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (response.url && response.url.indexOf('/admin/login') !== -1) {
        window.location.href = '/admin/login';
        return;
      }

      result = await response.json();

      if (result.success) {
        var deletedProductId = form.querySelector('input[name="productId"]')?.value;
        var deletedCategoryName = form.querySelector('input[name="categoryName"]')?.value;
        var deleteMessage = deletedCategoryName ? 'Category deleted successfully' : (deletedProductId ? 'Product deleted successfully' : 'Deleted successfully');
        showToast('success', result.message || deleteMessage);
        // Remove the deleted item from DOM
        productId = deletedProductId;
        categoryName = deletedCategoryName;

        if (productId) {
          var viewRow = document.querySelector('[data-view-panel="' + productId + '"]');
          var editRow = document.querySelector('[data-edit-row="' + productId + '"]');
          if (viewRow) {
            viewRow.remove();
          }
          if (editRow) {
            editRow.remove();
          }
          syncManagedProductsState(managedTotalProductCount - 1);
        }

        if (categoryName) {
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
