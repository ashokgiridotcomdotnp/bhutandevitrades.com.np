(function () {
  var form = document.querySelector('[data-order-page-form]');

  if (!form) {
    return;
  }

  var productIdInput = form.querySelector('[data-order-product-id]');
  var productNameInput = form.querySelector('[data-order-product-name]');
  var productTypeInput = form.querySelector('[data-order-product-type]');
  var quantityInput = form.querySelector('[data-order-quantity]');
  var unitPriceInput = form.querySelector('[data-order-unit-price]');
  var totalElement = form.querySelector('[data-order-total]');
  var customerNameInput = form.querySelector('[data-order-customer-name]');
  var phoneInput = form.querySelector('[data-order-phone]');
  var customerEmailInput = form.querySelector('[data-order-customer-email]');
  var noteInput = form.querySelector('[data-order-note]');
  var submitButtons = Array.prototype.slice.call(form.querySelectorAll('[data-order-submit]'));
  var successMessageElement = form.querySelector('[data-order-success]');
  var errorMessageElement = form.querySelector('[data-order-error]');
  var whatsappBaseUrl = String(form.getAttribute('data-whatsapp-base-url') || '').trim();
  var unitPriceValue = parsePositiveNumber(form.getAttribute('data-order-unit-price-value'));
  var unitPriceLabel = String(form.getAttribute('data-order-unit-price-label') || 'Contact for price').trim() || 'Contact for price';
  var availableStockQuantity = parseAvailableStockQuantity(form.getAttribute('data-order-stock-quantity'));

  function parsePositiveNumber(value) {
    var normalizedValue = String(value || '').replace(/,/g, '').replace(/[^0-9.]/g, '');
    var parsedValue = Number(normalizedValue);

    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      return 0;
    }

    return parsedValue;
  }

  function parseAvailableStockQuantity(value) {
    var cleanValue = String(value || '').trim();
    var parsedValue = Number(cleanValue);

    if (!cleanValue) {
      return 0;
    }

    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      return 0;
    }

    return Math.floor(parsedValue);
  }

  function normalizeOrderPhone(value) {
    var digits = String(value || '').replace(/[^0-9]/g, '');

    if (digits.indexOf('977') === 0 && digits.length === 13) {
      return digits.slice(3);
    }

    return digits;
  }

  function isValidOrderPhone(value) {
    return /^9[0-9]{9}$/.test(normalizeOrderPhone(value));
  }

  function toPositiveInteger(value) {
    var parsedValue = Number(value);

    if (!Number.isFinite(parsedValue) || parsedValue < 1) {
      return 1;
    }

    return Math.floor(parsedValue);
  }

  function formatNprAmount(value) {
    var parsedValue = Number(value);

    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      return '0';
    }

    return parsedValue.toLocaleString('en-IN', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0
    });
  }

  function refreshOrderTotal() {
    var quantity = toPositiveInteger(quantityInput.value);

    if (availableStockQuantity !== null && availableStockQuantity > 0 && quantity > availableStockQuantity) {
      quantity = availableStockQuantity;
      quantityInput.value = String(availableStockQuantity);
    }

    var totalPrice = quantity * unitPriceValue;

    unitPriceInput.value = unitPriceLabel;

    if (unitPriceValue > 0) {
      totalElement.textContent = 'NPR ' + formatNprAmount(totalPrice);
      return;
    }

    totalElement.textContent = 'Contact for price';
  }

  function buildFallbackWhatsappMessage(payload, totalLabel) {
    var lines = [];

    lines.push('Hello, I want to place an order.');
    lines.push('');
    lines.push('Product: ' + payload.productName);
    lines.push('Category: ' + payload.productType);
    lines.push('Quantity: ' + payload.quantity);
    lines.push('Unit Price: ' + payload.unitPriceLabel);
    lines.push('Total: ' + totalLabel);

    if (payload.customerName) {
      lines.push('Customer: ' + payload.customerName);
    }

    if (payload.phoneNumber) {
      lines.push('Phone: ' + payload.phoneNumber);
    }

    if (payload.customerEmail) {
      lines.push('Email: ' + payload.customerEmail);
    }

    if (payload.note) {
      lines.push('Note: ' + payload.note);
    }

    return lines.join('\n');
  }

  function validateOrderForm() {
    var quantityRaw = String(quantityInput && quantityInput.value ? quantityInput.value : '').trim();
    var quantityNumber = Number(quantityRaw);
    var customerName = String(customerNameInput && customerNameInput.value ? customerNameInput.value : '').trim();
    var phoneNumber = String(phoneInput && phoneInput.value ? phoneInput.value : '').trim();
    var customerEmail = String(customerEmailInput && customerEmailInput.value ? customerEmailInput.value : '').trim().toLowerCase();
    var note = String(noteInput && noteInput.value ? noteInput.value : '').trim();
    var hasError = false;

    quantityInput.setCustomValidity('');
    customerNameInput.setCustomValidity('');
    phoneInput.setCustomValidity('');
    customerEmailInput.setCustomValidity('');
    noteInput.setCustomValidity('');

    if (!quantityRaw) {
      quantityInput.setCustomValidity('Quantity is required.');
      hasError = true;
    } else if (!Number.isFinite(quantityNumber) || Math.floor(quantityNumber) !== quantityNumber || quantityNumber < 1 || quantityNumber > 999) {
      quantityInput.setCustomValidity('Quantity must be a whole number between 1 and 999.');
      hasError = true;
    } else if (availableStockQuantity !== null && availableStockQuantity < 1) {
      quantityInput.setCustomValidity('This product is currently out of stock.');
      hasError = true;
    } else if (availableStockQuantity !== null && quantityNumber > availableStockQuantity) {
      quantityInput.setCustomValidity('Only ' + availableStockQuantity + ' item(s) are currently in stock.');
      hasError = true;
    }

    if (!customerName) {
      customerNameInput.setCustomValidity('Customer name is required.');
      hasError = true;
    } else if (customerName.length < 2) {
      customerNameInput.setCustomValidity('Customer name must be at least 2 characters.');
      hasError = true;
    }

    if (!phoneNumber) {
      phoneInput.setCustomValidity('Phone number is required.');
      hasError = true;
    } else if (!isValidOrderPhone(phoneNumber)) {
      phoneInput.setCustomValidity('Enter a valid phone number like 98XXXXXXXX.');
      hasError = true;
    }

    if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      customerEmailInput.setCustomValidity('A valid account email is required.');
      hasError = true;
    }

    if (!note) {
      noteInput.setCustomValidity('Note is required.');
      hasError = true;
    } else if (note.length < 3) {
      noteInput.setCustomValidity('Note must be at least 3 characters.');
      hasError = true;
    }

    if (hasError) {
      form.reportValidity();
      return false;
    }

    return true;
  }

  function setSubmitting(isSubmitting, activeSubmitter) {
    setLoadingOverlay(Boolean(isSubmitting));

    if (!submitButtons.length) {
      return;
    }

    submitButtons.forEach(function (button) {
      var labelElement = button.querySelector('[data-order-submit-label]');
      var defaultLabel = String(button.getAttribute('data-default-label') || '').trim();

      if (!defaultLabel) {
        defaultLabel = labelElement ? String(labelElement.textContent || '').trim() : String(button.textContent || '').trim();
        button.setAttribute('data-default-label', defaultLabel);
      }

      button.disabled = Boolean(isSubmitting);

      if (labelElement) {
        labelElement.textContent = isSubmitting && activeSubmitter === button ? 'Submitting...' : defaultLabel;
        return;
      }

      button.textContent = isSubmitting && activeSubmitter === button ? 'Submitting...' : defaultLabel;
    });
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

  function clearMessages() {
    if (successMessageElement) {
      successMessageElement.classList.add('hidden');
      successMessageElement.textContent = '';
    }

    if (errorMessageElement) {
      errorMessageElement.classList.add('hidden');
      errorMessageElement.textContent = '';
    }
  }

  function showSuccess(message) {
    if (typeof window.bdShowToast === 'function') {
      window.bdShowToast({
        type: 'success',
        message: message,
      });
      return;
    }

    if (!successMessageElement) {
      return;
    }

    successMessageElement.textContent = message;
    successMessageElement.classList.remove('hidden');
  }

  function showError(message) {
    if (typeof window.bdShowToast === 'function') {
      window.bdShowToast({
        type: 'error',
        message: message,
      });
      return;
    }

    if (!errorMessageElement) {
      return;
    }

    errorMessageElement.textContent = message;
    errorMessageElement.classList.remove('hidden');
  }

  function clearOrderFormAfterSuccess() {
    if (quantityInput) {
      quantityInput.value = '1';
      quantityInput.setCustomValidity('');
    }

    if (customerNameInput) {
      customerNameInput.value = '';
      customerNameInput.setCustomValidity('');
    }

    if (phoneInput) {
      phoneInput.value = '';
      phoneInput.setCustomValidity('');
    }

    if (noteInput) {
      noteInput.value = '';
      noteInput.setCustomValidity('');
    }

    refreshOrderTotal();
  }

  form.addEventListener('submit', async function (event) {
    var submitter = event.submitter && event.submitter.matches('[data-order-submit]')
      ? event.submitter
      : null;
    var orderMethod = submitter ? String(submitter.getAttribute('data-order-method') || '').trim().toLowerCase() : '';
    var quantity = toPositiveInteger(quantityInput.value);
    var payload = {
      productId: String(productIdInput && productIdInput.value ? productIdInput.value : '').trim(),
      productName: String(productNameInput && productNameInput.value ? productNameInput.value : 'Product').trim(),
      productType: String(productTypeInput && productTypeInput.value ? productTypeInput.value : 'Category').trim(),
      quantity: quantity,
      unitPriceLabel: unitPriceLabel,
      unitPriceValue: unitPriceValue,
      customerName: String(customerNameInput && customerNameInput.value ? customerNameInput.value : '').trim(),
      phoneNumber: String(phoneInput && phoneInput.value ? phoneInput.value : '').trim(),
      customerEmail: String(customerEmailInput && customerEmailInput.value ? customerEmailInput.value : '').trim(),
      note: String(noteInput && noteInput.value ? noteInput.value : '').trim()
    };
    var totalLabel = unitPriceValue > 0 ? ('NPR ' + formatNprAmount(quantity * unitPriceValue)) : 'Contact for price';
    var response = null;
    var result = null;
    var shouldOpenWhatsapp = orderMethod === 'whatsapp';
    var whatsappMessage = '';
    var whatsappHref = '';

    event.preventDefault();
    clearMessages();
    if (!validateOrderForm()) {
      return;
    }
    refreshOrderTotal();
    setSubmitting(true, submitter);

    try {
      response = await fetch('/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      result = await response.json().catch(function () {
        return null;
      });

      if (response.status === 401) {
        window.location.href = '/login';
        return;
      }

      if (!response.ok || !result || !result.ok) {
        showError(result && result.message ? result.message : 'Could not submit order. Please try again.');
        return;
      }

      if (shouldOpenWhatsapp) {
        whatsappMessage = result.whatsappMessage || buildFallbackWhatsappMessage(payload, totalLabel);

        if (whatsappBaseUrl && whatsappBaseUrl !== 'https://wa.me/') {
          whatsappHref = whatsappBaseUrl + '?text=' + encodeURIComponent(whatsappMessage);
          window.open(whatsappHref, '_blank', 'noopener,noreferrer');
        }
      }

      if (shouldOpenWhatsapp) {
        clearOrderFormAfterSuccess();
        showSuccess(result.message || 'Order submitted. Opening WhatsApp...');
        return;
      }

      clearOrderFormAfterSuccess();
      showSuccess(result.message || 'Order submitted. Email sent successfully.');
    } catch (error) {
      showError('Could not submit order right now. Please try again.');
    } finally {
      setSubmitting(false, null);
    }
  });

  quantityInput.addEventListener('input', refreshOrderTotal);
  quantityInput.addEventListener('change', refreshOrderTotal);
  quantityInput.addEventListener('input', function () { quantityInput.setCustomValidity(''); });
  customerNameInput.addEventListener('input', function () { customerNameInput.setCustomValidity(''); });
  phoneInput.addEventListener('input', function () { phoneInput.setCustomValidity(''); });
  noteInput.addEventListener('input', function () { noteInput.setCustomValidity(''); });

  if (availableStockQuantity !== null) {
    if (availableStockQuantity > 0) {
      quantityInput.max = String(availableStockQuantity);
    } else {
      quantityInput.max = '1';
    }
  }

  refreshOrderTotal();
})();
