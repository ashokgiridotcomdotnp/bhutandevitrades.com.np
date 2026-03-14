(function () {
  function initProductCards(rootElement) {
    let scope = rootElement && typeof rootElement.querySelectorAll === 'function' ? rootElement : document;
    let productCards = scope.querySelectorAll('[data-product-card]');

    if (!productCards.length) {
      return;
    }

    function markReady(card) {
      card.classList.add('is-ready');
      card.classList.remove('is-loading');
    }

    productCards.forEach(function (card) {
      let image = null;
      let didResolve = false;

      if (card.classList.contains('is-ready')) {
        return;
      }

      image = card.querySelector('[data-product-image]');

      if (!image) {
        markReady(card);
        return;
      }

      if (image.complete && image.naturalWidth > 0) {
        markReady(card);
        return;
      }

      function resolveCard() {
        if (didResolve) {
          return;
        }

        didResolve = true;
        markReady(card);
        image.removeEventListener('load', resolveCard);
        image.removeEventListener('error', resolveCard);
      }

      image.addEventListener('load', resolveCard);
      image.addEventListener('error', resolveCard);

      setTimeout(resolveCard, 2500);
    });
  }

  window.bdInitProductCards = initProductCards;
  initProductCards(document);
})();

(function () {
  let productsSection = document.querySelector('[data-store-products]');
  let productsGrid = document.getElementById('products-grid');
  let pagination = productsSection ? productsSection.querySelector('[data-products-pagination]') : null;
  let sentinel = null;
  let observer = null;
  let loadingSkeletonGrid = null;
  let isLoading = false;
  let nextPageHref = productsSection ? String(productsSection.getAttribute('data-next-page-href') || '').trim() : '';

  if (!productsSection || !productsGrid || !nextPageHref) {
    return;
  }

  if (!window.fetch || !window.IntersectionObserver || !window.DOMParser) {
    return;
  }

  function setNextPageHref(href) {
    nextPageHref = String(href || '').trim();
    productsSection.setAttribute('data-next-page-href', nextPageHref);
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function buildLoadingSkeletonCard() {
    let card = document.createElement('article');

    card.className = 'pro-grid-card pointer-events-none relative overflow-hidden p-4';
    card.innerHTML = ''
      + '<div class="flex flex-col gap-3" aria-hidden="true">'
      + '  <span class="pro-skeleton-block h-52 w-full rounded-xl"></span>'
      + '  <div class="flex items-start justify-between gap-2">'
      + '    <span class="pro-skeleton-block h-5 w-3/5"></span>'
      + '    <span class="pro-skeleton-block h-5 w-20"></span>'
      + '  </div>'
      + '  <span class="pro-skeleton-block h-3.5 w-full"></span>'
      + '  <span class="pro-skeleton-block h-3.5 w-3/4"></span>'
      + '  <div class="mt-2 flex items-center justify-between gap-2">'
      + '    <span class="pro-skeleton-block h-6 w-28"></span>'
      + '    <span class="pro-skeleton-block h-8 w-20"></span>'
      + '  </div>'
      + '</div>';

    return card;
  }

  function ensureLoadingSkeletonGrid() {
    if (loadingSkeletonGrid) {
      return loadingSkeletonGrid;
    }

    loadingSkeletonGrid = document.createElement('div');
    loadingSkeletonGrid.className = 'hidden grid gap-4 sm:grid-cols-2 lg:grid-cols-3';
    loadingSkeletonGrid.setAttribute('data-products-loading', 'true');

    for (let index = 0; index < 3; index += 1) {
      loadingSkeletonGrid.appendChild(buildLoadingSkeletonCard());
    }

    productsGrid.insertAdjacentElement('afterend', loadingSkeletonGrid);
    return loadingSkeletonGrid;
  }

  function setLoadingSkeletonVisible(shouldShow) {
    let skeletonGrid = ensureLoadingSkeletonGrid();
    skeletonGrid.classList.toggle('hidden', !shouldShow);
  }

  function appendProductsFromHtml(htmlText) {
    let parser = new window.DOMParser();
    let doc = parser.parseFromString(htmlText, 'text/html');
    let fetchedSection = doc.querySelector('[data-store-products]');
    let fetchedGrid = doc.getElementById('products-grid');
    let cards = fetchedGrid ? fetchedGrid.querySelectorAll('[data-product-card]') : [];
    let fragment = document.createDocumentFragment();

    if (!fetchedSection || !cards.length) {
      setNextPageHref('');
      stopObserver();
      return;
    }

    cards.forEach(function (card) {
      fragment.appendChild(card);
    });

    productsGrid.appendChild(fragment);

    if (typeof window.bdOptimizeImages === 'function') {
      window.bdOptimizeImages(productsGrid);
    }

    if (typeof window.bdInitProductCards === 'function') {
      window.bdInitProductCards(productsGrid);
    }

    setNextPageHref(fetchedSection.getAttribute('data-next-page-href'));

    if (!nextPageHref) {
      stopObserver();
    }
  }

  function loadMoreProducts() {
    if (isLoading || !nextPageHref) {
      return;
    }

    isLoading = true;
    setLoadingSkeletonVisible(true);

    window.fetch(nextPageHref, {
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
      },
    }).then(function (response) {
      if (!response.ok) {
        throw new Error('Failed to load more products');
      }

      return response.text();
    }).then(function (htmlText) {
      appendProductsFromHtml(htmlText);
    }).catch(function () {
      stopObserver();
    }).finally(function () {
      isLoading = false;
      setLoadingSkeletonVisible(false);
    });
  }

  if (pagination) {
    pagination.classList.add('hidden');
  }

  sentinel = document.createElement('div');
  sentinel.setAttribute('data-products-sentinel', 'true');
  sentinel.style.width = '100%';
  sentinel.style.height = '1px';
  productsSection.appendChild(sentinel);

  observer = new window.IntersectionObserver(function (entries) {
    let shouldLoad = entries.some(function (entry) {
      return entry && entry.isIntersecting;
    });

    if (shouldLoad) {
      loadMoreProducts();
    }
  }, {
    rootMargin: '360px 0px',
  });

  observer.observe(sentinel);
})();

(function () {
  let root = document.querySelector('[data-home-carousel]');
  if (!root) {
    return;
  }

  let track = root.querySelector('[data-carousel-track]');
  let dots = root.querySelectorAll('[data-carousel-dot]');
  let prevBtn = root.querySelector('[data-carousel-prev]');
  let nextBtn = root.querySelector('[data-carousel-next]');
  let totalSlides = dots.length;
  let activeIndex = 0;
  let autoTimer;
  let prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (!track || totalSlides <= 1) {
    return;
  }

  function update() {
    track.style.transform = 'translateX(-' + (activeIndex * 100) + '%)';
    dots.forEach(function (dot, idx) {
      dot.style.backgroundColor = idx === activeIndex ? 'rgb(14 116 144)' : 'rgba(255, 255, 255, 0.7)';
    });
  }

  function goNext() {
    activeIndex = (activeIndex + 1) % totalSlides;
    update();
  }

  function goPrev() {
    activeIndex = (activeIndex - 1 + totalSlides) % totalSlides;
    update();
  }

  function restartAuto() {
    if (prefersReducedMotion) {
      return;
    }

    if (autoTimer) {
      clearInterval(autoTimer);
    }

    autoTimer = setInterval(goNext, 4500);
  }

  if (nextBtn) {
    nextBtn.addEventListener('click', function () {
      goNext();
      restartAuto();
    });
  }

  if (prevBtn) {
    prevBtn.addEventListener('click', function () {
      goPrev();
      restartAuto();
    });
  }

  dots.forEach(function (dot) {
    dot.addEventListener('click', function () {
      let index = Number(dot.getAttribute('data-carousel-index'));
      if (Number.isNaN(index)) {
        return;
      }

      activeIndex = index;
      update();
      restartAuto();
    });
  });

  if (prefersReducedMotion) {
    track.style.transition = 'none';
  }

  update();
  restartAuto();
})();

(function () {
  let modal = document.querySelector('[data-order-modal]');
  let openButtons = document.querySelectorAll('[data-order-open]');

  if (!modal || !openButtons.length) {
    return;
  }

  let closeButtons = modal.querySelectorAll('[data-order-close]');
  let modalPanel = modal.querySelector('[data-order-modal-panel]');
  let form = modal.querySelector('[data-order-form]');
  let quantityInput = modal.querySelector('[data-order-quantity]');
  let unitPriceInput = modal.querySelector('[data-order-unit-price]');
  let totalElement = modal.querySelector('[data-order-total]');
  let productNameElement = modal.querySelector('[data-order-product-name]');
  let productTypeElement = modal.querySelector('[data-order-product-type]');
  let customerNameInput = modal.querySelector('[data-order-customer-name]');
  let phoneInput = modal.querySelector('[data-order-phone]');
  let customerEmailInput = modal.querySelector('[data-order-customer-email]');
  let noteInput = modal.querySelector('[data-order-note]');
  let submitButton = form ? form.querySelector('button[type="submit"]') : null;
  let whatsappBaseUrl = String(modal.getAttribute('data-whatsapp-base-url') || '').trim();
  let authName = String(modal.getAttribute('data-order-auth-name') || '').trim();
  let authEmail = String(modal.getAttribute('data-order-auth-email') || '').trim().toLowerCase();
  let modalCloseTimer = null;
  let modalTransitionDuration = 300;
  let currentProduct = {
    id: '',
    name: '',
    type: '',
    unitPriceLabel: 'Contact for price',
    unitPriceValue: 0,
  };

  function parsePositiveNumber(value) {
    let parsedValue = Number(String(value || '').replace(/,/g, '').replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
      return 0;
    }
    return parsedValue;
  }

  function toPositiveInteger(value) {
    let parsedValue = Number(value);
    if (!Number.isFinite(parsedValue) || parsedValue < 1) {
      return 1;
    }
    return Math.floor(parsedValue);
  }

  function formatNprAmount(value) {
    let parsedValue = Number(value);
    if (!Number.isFinite(parsedValue) || parsedValue < 0) {
      return '0';
    }
    return parsedValue.toLocaleString('en-IN', {
      maximumFractionDigits: 2,
      minimumFractionDigits: 0,
    });
  }

  function refreshOrderTotal() {
    let quantity = toPositiveInteger(quantityInput.value);
    let unitPrice = parsePositiveNumber(currentProduct.unitPriceValue);
    let total = quantity * unitPrice;

    unitPriceInput.value = currentProduct.unitPriceLabel;

    if (unitPrice > 0) {
      totalElement.textContent = 'NPR ' + formatNprAmount(total);
      return;
    }

    totalElement.textContent = 'Contact for price';
  }

  function buildLocalWhatsappMessage(orderData) {
    let lines = [];

    lines.push('Hello, I want to place an order.');
    lines.push('');
    lines.push('Product: ' + orderData.productName);
    lines.push('Category: ' + orderData.productType);
    lines.push('Quantity: ' + orderData.quantity);
    lines.push('Unit Price: ' + orderData.unitPriceLabel);
    lines.push('Total: ' + orderData.totalLabel);

    if (orderData.customerName) {
      lines.push('Customer: ' + orderData.customerName);
    }

    if (orderData.phoneNumber) {
      lines.push('Phone: ' + orderData.phoneNumber);
    }

    if (orderData.customerEmail) {
      lines.push('Email: ' + orderData.customerEmail);
    }

    if (orderData.note) {
      lines.push('Note: ' + orderData.note);
    }

    return lines.join('\n');
  }

  function setSubmitting(isSubmitting) {
    if (!submitButton) {
      return;
    }

    submitButton.disabled = Boolean(isSubmitting);
    submitButton.textContent = isSubmitting ? 'Submitting...' : 'Submit Order';
  }

  function showToast(type, message) {
    if (typeof window.bdShowToast !== 'function') {
      return;
    }

    window.bdShowToast({
      type: type === 'error' ? 'error' : 'success',
      message: String(message || '').trim(),
    });
  }

  function clearModalCloseTimer() {
    if (modalCloseTimer) {
      clearTimeout(modalCloseTimer);
      modalCloseTimer = null;
    }
  }

  function openModal(button) {
    currentProduct.id = String(button.getAttribute('data-product-id') || '').trim();
    currentProduct.name = String(button.getAttribute('data-product-name') || 'Product').trim();
    currentProduct.type = String(button.getAttribute('data-product-type') || 'Category').trim();
    currentProduct.unitPriceLabel = String(button.getAttribute('data-product-price-display') || 'Contact for price').trim();
    currentProduct.unitPriceValue = parsePositiveNumber(button.getAttribute('data-product-price-value'));

    productNameElement.textContent = currentProduct.name || 'Product';
    productTypeElement.textContent = currentProduct.type || 'Category';

    if (quantityInput) {
      quantityInput.value = '1';
    }
    if (customerNameInput) {
      customerNameInput.value = authName;
    }
    if (phoneInput) {
      phoneInput.value = '';
    }
    if (customerEmailInput) {
      customerEmailInput.value = authEmail;
    }
    if (noteInput) {
      noteInput.value = '';
    }

    refreshOrderTotal();
    setSubmitting(false);
    clearModalCloseTimer();
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.classList.add('opacity-0');

    if (modalPanel) {
      modalPanel.classList.add('translate-y-3', 'scale-[0.98]', 'opacity-0');
    }

    requestAnimationFrame(function () {
      modal.classList.remove('opacity-0');

      if (modalPanel) {
        modalPanel.classList.remove('translate-y-3', 'scale-[0.98]', 'opacity-0');
      }
    });

    document.body.style.overflow = 'hidden';

    if (quantityInput) {
      quantityInput.focus();
      quantityInput.select();
    }
  }

  function closeModal() {
    clearModalCloseTimer();
    modal.classList.add('opacity-0');

    if (modalPanel) {
      modalPanel.classList.add('translate-y-3', 'scale-[0.98]', 'opacity-0');
    }

    modalCloseTimer = setTimeout(function () {
      modal.classList.add('hidden');
      modal.classList.remove('flex');
      modalCloseTimer = null;
    }, modalTransitionDuration);

    document.body.style.overflow = '';
  }

  openButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      openModal(button);
    });
  });

  closeButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      closeModal();
    });
  });

  modal.addEventListener('click', function (event) {
    if (event.target === modal) {
      closeModal();
    }
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });

  if (quantityInput) {
    quantityInput.addEventListener('input', refreshOrderTotal);
    quantityInput.addEventListener('change', refreshOrderTotal);
  }

  if (!form) {
    return;
  }

  form.addEventListener('submit', async function (event) {
    let quantity = toPositiveInteger(quantityInput.value);
    let unitPrice = parsePositiveNumber(currentProduct.unitPriceValue);
    let total = unitPrice > 0 ? quantity * unitPrice : 0;
    let customerName = String(customerNameInput && customerNameInput.value ? customerNameInput.value : '').trim();
    let phoneNumber = String(phoneInput && phoneInput.value ? phoneInput.value : '').trim();
    let customerEmail = String(customerEmailInput && customerEmailInput.value ? customerEmailInput.value : '').trim().toLowerCase();
    let note = String(noteInput && noteInput.value ? noteInput.value : '').trim();
    let totalLabel = unitPrice > 0 ? ('NPR ' + formatNprAmount(total)) : 'Contact for price';
    let payload = {
      productId: currentProduct.id,
      productName: currentProduct.name || 'Product',
      productType: currentProduct.type || 'N/A',
      quantity: quantity,
      unitPriceLabel: currentProduct.unitPriceLabel || 'Contact for price',
      unitPriceValue: unitPrice,
      customerName: customerName,
      phoneNumber: phoneNumber,
      customerEmail: customerEmail,
      note: note,
    };
    let targetUrl = '';
    let response = null;
    let result = null;
    let whatsappMessage = '';

    event.preventDefault();

    setSubmitting(true);

    try {
      response = await fetch('/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      result = await response.json().catch(function () {
        return null;
      });

      if (!response.ok || !result || !result.ok) {
        if (response.status === 401 || (result && (result.errorCode === 'auth-required' || result.errorCode === 'invalid-auth-session'))) {
          window.location.href = '/login';
          return;
        }

        showToast('error', result && result.message ? result.message : 'Could not submit order. Please try again.');
        return;
      }

      whatsappMessage = result.whatsappMessage || buildLocalWhatsappMessage({
        productName: payload.productName,
        productType: payload.productType,
        quantity: quantity,
        unitPriceLabel: payload.unitPriceLabel,
        totalLabel: totalLabel,
        customerName: customerName,
        phoneNumber: phoneNumber,
        customerEmail: customerEmail,
        note: note,
      });

      if (whatsappBaseUrl && whatsappBaseUrl !== 'https://wa.me/') {
        targetUrl = whatsappBaseUrl + '?text=' + encodeURIComponent(whatsappMessage);
        window.open(targetUrl, '_blank', 'noopener,noreferrer');
      }

      closeModal();
      showToast('success', result && result.message ? result.message : 'Order submitted. Email sent successfully.');
    } catch (error) {
      showToast('error', 'Could not submit order right now. Please try again.');
    } finally {
      setSubmitting(false);
    }
  });
})();
