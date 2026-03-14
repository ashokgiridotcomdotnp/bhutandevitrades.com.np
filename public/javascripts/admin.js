(function () {
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
    let response = null;
    let payloadResult = { payload: null, text: '' };

    response = await fetch(url, options);

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

    payloadResult = await readResponsePayload(response);

    return {
      response: response,
      payload: payloadResult.payload,
      redirectedToLogin: false,
    };
  }

  function getPageData() {
    let dataScript = document.getElementById('admin-page-data');
    if (!dataScript) {
      return {};
    }

    try {
      return JSON.parse(dataScript.textContent || '{}');
    } catch (error) {
      return {};
    }
  }

  let pageData = getPageData();
  let subcategoryOptionsByCategory = pageData && typeof pageData === 'object' && pageData.subcategoryOptionsByCategory
    ? pageData.subcategoryOptionsByCategory
    : {};
  let deleteAlert = document.getElementById('delete-alert');
  let deleteAlertTitle = document.getElementById('delete-alert-title');
  let deleteAlertMessage = document.getElementById('delete-alert-message');
  let deleteAlertCancel = document.getElementById('delete-alert-cancel');
  let deleteAlertConfirm = document.getElementById('delete-alert-confirm');
  let pendingDeleteForm = null;
  let quickAddCategoryInput = document.querySelector('[data-product-category-input]');
  let quickAddSubcategoryPicker = document.querySelector('[data-product-subcategory-picker]');
  let quickAddSubcategoryCustomInput = document.querySelector('[data-product-subcategory-custom-input]');
  let quickAddMrpInput = document.querySelector('[data-product-mrp-input]');
  let quickAddDiscountInput = document.querySelector('[data-product-discount-input]');
  let quickAddPricePreview = document.querySelector('[data-product-price-preview]');
  let quickAddPriceOriginal = document.querySelector('[data-product-price-original]');
  let quickAddPriceFinal = document.querySelector('[data-product-price-final]');
  let quickAddProductForm = document.querySelector('form[action="/admin/products"][enctype="multipart/form-data"]');
  let productOverviewRoot = document.querySelector('[data-product-overview-root]');
  let categorySection = document.querySelector('[data-category-section]');
  let categoryManageDetails = categorySection ? categorySection.querySelector('[data-category-manage-details]') : null;
  let categoryManageBody = categoryManageDetails ? categoryManageDetails.querySelector('[data-category-manage-body]') : null;
  let categoryCardsGrid = document.querySelector('[data-category-card-grid]');
  let categoryEmptyState = document.querySelector('[data-category-empty-state]');
  let categoryFilterButtons = categorySection ? categorySection.querySelector('[data-category-filter-buttons]') : null;
  let categoryCountBadge = document.querySelector('[data-category-count-badge]');
  let dashboardTotalCategories = document.querySelector('[data-dashboard-total-categories]');
  let dashboardEmptyCategories = document.querySelector('[data-dashboard-empty-categories]');
  let statusTooltip = document.querySelector('[data-status-tooltip]');
  let hasDeleteModal = Boolean(deleteAlert && deleteAlertTitle && deleteAlertMessage && deleteAlertCancel && deleteAlertConfirm);
  let isCategoryFilterMode = Boolean(categorySection && categorySection.getAttribute('data-category-filter-mode') === 'products');

  function getCategoryManageContainer() {
    return categoryManageBody || categorySection;
  }

  function getActiveCategorySlugFromLocation() {
    if (!isCategoryFilterMode) {
      return '';
    }

    try {
      let url = new URL(window.location.href);
      return normalizeCategoryKey(url.searchParams.get('category'));
    } catch (error) {
      return '';
    }
  }

  function getCategoryCardProductCount(card) {
    let badge = card ? card.querySelector('[data-category-product-count]') : null;
    let match = badge ? String(badge.textContent || '').match(/\d+/) : null;
    return match ? parseInt(match[0], 10) || 0 : 0;
  }

  function createCategoryFilterButton(config) {
    let data = config && typeof config === 'object' ? config : {};
    let label = String(data.label || '').trim();
    let count = Number(data.count);
    let href = String(data.href || '').trim();
    let isActive = Boolean(data.isActive);
    let key = String(data.key || '').trim();

    if (!label || !href) {
      return null;
    }

    let el = document.createElement('a');
    el.href = href;
    el.className = (isActive ? 'pro-btn-primary' : 'pro-btn-secondary') + ' pro-btn-xs';
    el.setAttribute('data-category-filter-button', key || '');

    if (isActive) {
      el.setAttribute('aria-current', 'page');
    }

    el.innerHTML =
      '<span class="max-w-[10rem] truncate">' + escapeHtml(label) + '</span>' +
      '<span class="ml-1 inline-flex items-center justify-center rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-700">' + (Number.isFinite(count) ? String(count) : '0') + '</span>';

    return el;
  }

  function syncCategoryFilterButtons() {
    if (!isCategoryFilterMode || !categoryFilterButtons) {
      return;
    }

    let activeSlug = getActiveCategorySlugFromLocation();
    let cards = categoryCardsGrid ? Array.prototype.slice.call(categoryCardsGrid.querySelectorAll('[data-category-card]')) : [];
    let totalProductCount = 0;

    cards.forEach(function (card) {
      totalProductCount += getCategoryCardProductCount(card);
    });

    let declaredAllCount = Number(categoryFilterButtons.getAttribute('data-all-product-count'));
    let allCount = Number.isFinite(declaredAllCount) && declaredAllCount >= 0
      ? declaredAllCount
      : totalProductCount;

    categoryFilterButtons.innerHTML = '';

    let allButton = createCategoryFilterButton({
      key: '__all__',
      label: 'All',
      count: allCount,
      href: '/admin/products',
      isActive: !activeSlug,
    });

    if (allButton) {
      categoryFilterButtons.appendChild(allButton);
    }

    cards.forEach(function (card) {
      let slug = normalizeCategoryKey(card.getAttribute('data-category-card'));
      let title = card.querySelector('[data-category-card-title]');
      let name = String(title && title.textContent ? title.textContent : '').trim();
      let count = getCategoryCardProductCount(card);

      if (!slug || !name) {
        return;
      }

      let button = createCategoryFilterButton({
        key: slug,
        label: name,
        count: count,
        href: '/admin/products?category=' + encodeURIComponent(slug),
        isActive: slug === activeSlug,
      });

      if (button) {
        categoryFilterButtons.appendChild(button);
      }
    });
  }

  function clearAdminFlashQueryParams() {
    if (!window.history || typeof window.history.replaceState !== 'function') {
      return;
    }

    let currentUrl = new URL(window.location.href);
    let hasStatus = currentUrl.searchParams.has('status');
    let hasError = currentUrl.searchParams.has('error');

    if (!hasStatus && !hasError) {
      return;
    }

    currentUrl.searchParams.delete('status');
    currentUrl.searchParams.delete('error');

    let nextQuery = currentUrl.searchParams.toString();
    let nextUrl = currentUrl.pathname + (nextQuery ? '?' + nextQuery : '') + currentUrl.hash;
    window.history.replaceState({}, document.title, nextUrl);
  }

  function bindFileInputLabel(input) {
    let inputId = input && input.id ? input.id : '';
    let preview = inputId ? document.querySelector('[data-image-preview-for="' + inputId + '"]') : null;
    let previewPlaceholder = inputId ? document.querySelector('[data-image-preview-placeholder-for="' + inputId + '"]') : null;
    let fileName = inputId ? document.querySelector('[data-file-name-for="' + inputId + '"]') : null;
    let defaultFileName = fileName
      ? String(fileName.getAttribute('data-file-default-text') || fileName.textContent || 'No file selected').trim()
      : '';
    let defaultPreviewSrc = preview
      ? String(preview.getAttribute('data-image-preview-default-src') || preview.getAttribute('src') || '').trim()
      : '';
    let objectUrl = '';

    if (!inputId || (!preview && !previewPlaceholder && !fileName)) {
      return;
    }

    function syncFileNameLabel(label) {
      if (!fileName) {
        return;
      }

      fileName.textContent = String(label || defaultFileName || 'No file selected').trim();
    }

    function clearPreview() {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = '';
      }

      if (preview) {
        if (defaultPreviewSrc) {
          preview.src = defaultPreviewSrc;
          preview.classList.remove('hidden');
          if (previewPlaceholder) previewPlaceholder.classList.add('hidden');
        } else {
          preview.src = '';
          preview.classList.add('hidden');
          if (previewPlaceholder) previewPlaceholder.classList.remove('hidden');
        }
      }

      syncFileNameLabel(defaultFileName);
    }

    function syncFileName() {
      let selectedFile = input.files && input.files.length ? input.files[0] : null;

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

      if (previewPlaceholder) {
        previewPlaceholder.classList.add('hidden');
      }
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

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>"']/g, function (character) {
      if (character === '&') {
        return '&amp;';
      }
      if (character === '<') {
        return '&lt;';
      }
      if (character === '>') {
        return '&gt;';
      }
      if (character === '"') {
        return '&quot;';
      }
      return '&#39;';
    });
  }

  function parseCategoryItemsInput(value) {
    return String(value || '')
      .split(/[,\n]+/)
      .map(function (item) {
        return String(item || '').replace(/\s+/g, ' ').trim();
      })
      .filter(Boolean);
  }

  function sortQuickAddCategoryOptions() {
    let placeholderOption = null;
    let categoryOptions = [];

    if (!quickAddCategoryInput || !quickAddCategoryInput.options.length) {
      return;
    }

    placeholderOption = quickAddCategoryInput.options[0].cloneNode(true);
    categoryOptions = Array.prototype.slice.call(quickAddCategoryInput.options, 1).sort(function (left, right) {
      return String(left.textContent || '').localeCompare(String(right.textContent || ''));
    });

    quickAddCategoryInput.innerHTML = '';
    quickAddCategoryInput.appendChild(placeholderOption);
    categoryOptions.forEach(function (option) {
      quickAddCategoryInput.appendChild(option);
    });
  }

  function upsertQuickAddCategoryOption(categoryName, originalCategoryName) {
    let cleanedName = String(categoryName || '').trim();
    let previousName = String(originalCategoryName || '').trim();
    let currentSelection = quickAddCategoryInput ? String(quickAddCategoryInput.value || '').trim() : '';
    let option = null;

    if (!quickAddCategoryInput || !cleanedName) {
      return;
    }

    option = Array.prototype.find.call(quickAddCategoryInput.options, function (candidate) {
      return candidate && (candidate.value === previousName || candidate.value === cleanedName);
    }) || null;

    if (!option) {
      option = document.createElement('option');
      quickAddCategoryInput.appendChild(option);
    }

    option.value = cleanedName;
    option.textContent = cleanedName;
    sortQuickAddCategoryOptions();

    if (currentSelection === previousName || currentSelection === cleanedName) {
      quickAddCategoryInput.value = cleanedName;
    }
  }

  function removeQuickAddCategoryOption(categoryName) {
    let cleanedName = String(categoryName || '').trim();

    if (!quickAddCategoryInput || !cleanedName) {
      return;
    }

    Array.prototype.slice.call(quickAddCategoryInput.options, 1).forEach(function (option) {
      if (option && option.value === cleanedName) {
        option.remove();
      }
    });

    if (String(quickAddCategoryInput.value || '').trim() === cleanedName) {
      clearQuickAddCategorySelection();
    }
  }

  function syncCategorySubcategoryMap(categoryName, categoryItems, originalCategoryName) {
    let cleanedName = String(categoryName || '').trim();
    let previousName = String(originalCategoryName || '').trim();
    let newKey = normalizeCategoryKey(cleanedName);
    let oldKey = normalizeCategoryKey(previousName);
    let normalizedItems = Array.isArray(categoryItems)
      ? categoryItems
        .map(function (item) {
          return String(item || '').replace(/\s+/g, ' ').trim();
        })
        .filter(Boolean)
      : [];

    if (!newKey) {
      return;
    }

    normalizedItems.sort(function (left, right) {
      return left.localeCompare(right);
    });

    if (oldKey && oldKey !== newKey) {
      delete subcategoryOptionsByCategory[oldKey];
    }

    subcategoryOptionsByCategory[newKey] = normalizedItems;

    if (quickAddCategoryInput) {
      let currentCategoryKey = normalizeCategoryKey(quickAddCategoryInput.value);
      if (currentCategoryKey === oldKey || currentCategoryKey === newKey) {
        quickAddCategoryInput.value = cleanedName;
        syncQuickAddSubcategoryOptions();
      }
    }
  }

  function ensureCategoryCardsGrid() {
    if (categoryCardsGrid) {
      return categoryCardsGrid;
    }

    let container = getCategoryManageContainer();

    if (!container) {
      return null;
    }

    categoryCardsGrid = document.createElement('div');
    categoryCardsGrid.className = 'grid auto-rows-fr gap-3 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))] pro-stagger';
    categoryCardsGrid.setAttribute('data-category-card-grid', '');
    container.appendChild(categoryCardsGrid);
    return categoryCardsGrid;
  }

  function ensureCategoryEmptyState() {
    if (categoryEmptyState) {
      return categoryEmptyState;
    }

    let container = getCategoryManageContainer();

    if (!container) {
      return null;
    }

    categoryEmptyState = document.createElement('div');
    categoryEmptyState.className = 'rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600';
    categoryEmptyState.setAttribute('data-category-empty-state', '');
    categoryEmptyState.textContent = 'No categories available yet. Create your first category above.';
    container.appendChild(categoryEmptyState);
    return categoryEmptyState;
  }

  function updateDashboardCategoryCounts() {
    if (!categorySection) {
      return;
    }

    let cards = categoryCardsGrid ? categoryCardsGrid.querySelectorAll('[data-category-card]') : [];
    let totalCount = cards.length;
    let emptyCount = 0;

    Array.prototype.forEach.call(cards, function (card) {
      if (getCategoryCardProductCount(card) === 0) {
        emptyCount += 1;
      }
    });

    if (categoryCountBadge) {
      categoryCountBadge.textContent = String(totalCount);
    }

    if (dashboardTotalCategories) {
      dashboardTotalCategories.textContent = String(totalCount);
    }

    if (dashboardEmptyCategories) {
      dashboardEmptyCategories.textContent = String(emptyCount);
    }

    if (totalCount === 0) {
      if (categoryCardsGrid) {
        categoryCardsGrid.classList.add('hidden');
      }
      let emptyState = ensureCategoryEmptyState();
      if (emptyState) {
        emptyState.classList.remove('hidden');
      }
      if (categoryManageDetails) {
        categoryManageDetails.open = true;
      }
      syncCategoryFilterButtons();
      return;
    }

    if (categoryCardsGrid) {
      categoryCardsGrid.classList.remove('hidden');
    }

    if (categoryEmptyState) {
      categoryEmptyState.classList.add('hidden');
    }

    syncCategoryFilterButtons();
  }

  function renderCategoryItemChips(container, items) {
    if (!container) {
      return;
    }

    container.innerHTML = '';

    if (!Array.isArray(items) || !items.length) {
      container.classList.add('hidden');
      return;
    }

    container.classList.remove('hidden');
    items.slice(0, 4).forEach(function (itemName) {
      let chip = document.createElement('span');
      chip.className = 'rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700';
      chip.textContent = itemName;
      container.appendChild(chip);
    });
  }

  function bindEditCategoryTrigger(button) {
    if (!button || button.getAttribute('data-bound-edit-category') === '1') {
      return;
    }

    button.setAttribute('data-bound-edit-category', '1');
    button.addEventListener('click', function () {
      let categoryName = button.getAttribute('data-category-name') || '';
      let categoryItems = button.getAttribute('data-category-items') || '';
      setCategoryFormToEditMode(categoryName, categoryItems);
    });
  }

  function bindDeleteCategoryTrigger(button) {
    if (!button || button.getAttribute('data-bound-delete-category') === '1') {
      return;
    }

    button.setAttribute('data-bound-delete-category', '1');
    button.addEventListener('click', function () {
      let categoryKey = button.getAttribute('data-delete-category-trigger');
      let categoryName = button.getAttribute('data-category-name') || 'this category';
      let form = document.querySelector('[data-delete-category-form="' + categoryKey + '"]');

      showDeleteAlert(
        form,
        'Delete Category',
        'Delete category "' + categoryName + '" and all products inside it? This action cannot be undone.'
      );
    });
  }

  function createCategoryCardElement(categoryName, categoryItems) {
    let cleanedName = String(categoryName || '').trim();
    let normalizedItems = Array.isArray(categoryItems) ? categoryItems.filter(Boolean) : [];
    let categoryKey = normalizeCategoryKey(cleanedName);
    let article = document.createElement('article');

    article.className = 'grid h-full gap-3 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/90 p-4 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md';
    article.setAttribute('data-category-card', categoryKey);
    article.innerHTML =
      '<div class="flex items-start gap-3">' +
      '<div class="min-w-0 flex-1 grid gap-1">' +
      '<div class="flex flex-wrap items-center gap-2">' +
      '<h3 class="truncate text-lg font-bold text-slate-900" data-category-card-title>' + escapeHtml(cleanedName) + '</h3>' +
      '<span class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-700" data-category-product-count>0 products</span>' +
      '</div>' +
      '<p class="text-sm text-slate-600" data-category-card-summary>' +
      (normalizedItems.length ? escapeHtml(normalizedItems.length + ' configured items ready for quick add.') : 'No configured subcategories yet.') +
      '</p>' +
      '</div>' +
      '</div>' +
      '<div class="' + (normalizedItems.length ? 'flex flex-wrap gap-2' : 'hidden flex-wrap gap-2') + '" data-category-items-list></div>' +
      '<div class="rounded-xl border border-dashed border-slate-200 bg-white/80 p-3 text-sm text-slate-500">' +
      'No products mapped yet. You can still edit or delete this category.' +
      '</div>' +
      '<div class="grid gap-2 sm:grid-cols-3">' +
      (isCategoryFilterMode
        ? ('<a href="/admin/products?category=' + encodeURIComponent(categoryKey) + '" data-category-filter-link class="pro-btn-secondary w-full justify-center px-3 py-1.5 text-xs">Filter</a>')
        : '<span class="hidden sm:block"></span>') +
      '<a href="/admin/categories/' + categoryKey + '" data-category-manage-link class="pro-btn-secondary w-full justify-center px-3 py-1.5 text-xs">Manage</a>' +
      '<button type="button" data-edit-category-trigger data-category-name="' + escapeHtml(cleanedName) + '" data-category-items="' + escapeHtml(normalizedItems.join(', ')) + '" class="pro-btn-secondary w-full justify-center px-3 py-1.5 text-xs">Edit</button>' +
      '</div>' +
      '<div class="grid gap-2 sm:grid-cols-3">' +
      '<span class="hidden sm:block"></span>' +
      '<span class="hidden sm:block"></span>' +
      '<button type="button" data-delete-category-trigger="' + categoryKey + '" data-category-name="' + escapeHtml(cleanedName) + '" class="pro-btn-danger-muted w-full justify-center px-3 py-1.5 text-xs">Delete</button>' +
      '</div>' +
      '<form action="/admin/categories/delete" method="post" class="hidden" data-delete-category-form="' + categoryKey + '">' +
      '<input type="hidden" name="categoryName" value="' + escapeHtml(cleanedName) + '" />' +
      '<input type="hidden" name="redirectTo" value="' + (isCategoryFilterMode ? '/admin/products' : '/admin') + '" />' +
      '</form>';

    renderCategoryItemChips(article.querySelector('[data-category-items-list]'), normalizedItems);
    bindEditCategoryTrigger(article.querySelector('[data-edit-category-trigger]'));
    bindDeleteCategoryTrigger(article.querySelector('[data-delete-category-trigger]'));
    return article;
  }

  function upsertDashboardCategoryCard(categoryName, categoryItems, originalCategoryName) {
    let cleanedName = String(categoryName || '').trim();
    let previousName = String(originalCategoryName || '').trim();
    let categoryKey = normalizeCategoryKey(cleanedName);
    let previousKey = normalizeCategoryKey(previousName);
    let normalizedItems = Array.isArray(categoryItems) ? categoryItems.filter(Boolean) : [];
    let card = null;
    let isNewCard = false;
    let title = null;
    let summary = null;
    let chips = null;
    let manageLink = null;
    let editButton = null;
    let deleteButton = null;
    let deleteForm = null;
    let deleteFormCategoryInput = null;

    if (!cleanedName) {
      return;
    }

    card = document.querySelector('[data-category-card="' + previousKey + '"]') || document.querySelector('[data-category-card="' + categoryKey + '"]');

    if (!card) {
      let cardsGrid = ensureCategoryCardsGrid();
      if (!cardsGrid) {
        return;
      }
      card = createCategoryCardElement(cleanedName, normalizedItems);
      cardsGrid.prepend(card);
      isNewCard = true;
    }

    card.setAttribute('data-category-card', categoryKey);

    title = card.querySelector('[data-category-card-title]');
    summary = card.querySelector('[data-category-card-summary]');
    chips = card.querySelector('[data-category-items-list]');
    manageLink = card.querySelector('[data-category-manage-link]');
    let filterLink = card.querySelector('[data-category-filter-link]');
    editButton = card.querySelector('[data-edit-category-trigger]');
    deleteButton = card.querySelector('[data-delete-category-trigger]');
    deleteForm = card.querySelector('form[action="/admin/categories/delete"]');
    deleteFormCategoryInput = deleteForm ? deleteForm.querySelector('input[name="categoryName"]') : null;

    if (title) {
      title.textContent = cleanedName;
    }

    if (summary) {
      summary.textContent = normalizedItems.length
        ? normalizedItems.length + ' configured items ready for quick add.'
        : 'No configured subcategories yet.';
    }

    renderCategoryItemChips(chips, normalizedItems);

    if (manageLink) {
      manageLink.href = '/admin/categories/' + categoryKey;
    }

    if (filterLink && isCategoryFilterMode) {
      filterLink.href = '/admin/products?category=' + encodeURIComponent(categoryKey);
    }

    if (editButton) {
      editButton.setAttribute('data-category-name', cleanedName);
      editButton.setAttribute('data-category-items', normalizedItems.join(', '));
      bindEditCategoryTrigger(editButton);
    }

    if (deleteButton) {
      deleteButton.setAttribute('data-delete-category-trigger', categoryKey);
      deleteButton.setAttribute('data-category-name', cleanedName);
      bindDeleteCategoryTrigger(deleteButton);
    }

    if (deleteForm) {
      deleteForm.setAttribute('data-delete-category-form', categoryKey);
    }

    if (deleteFormCategoryInput) {
      deleteFormCategoryInput.value = cleanedName;
    }

    updateDashboardCategoryCounts();
    return {
      card: card,
      isNewCard: isNewCard,
    };
  }

  function getCategorySubcategoryOptions(categoryName) {
    let categoryKey = normalizeCategoryKey(categoryName);
    let options = categoryKey ? subcategoryOptionsByCategory[categoryKey] : [];
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
      let placeholderOption = document.createElement('option');
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

    let options = getCategorySubcategoryOptions(quickAddCategoryInput.value);
    let previousValue = String(quickAddSubcategoryPicker.value || '').trim();
    let hasPreviousValue = false;

    quickAddSubcategoryPicker.innerHTML = '';

    let placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = options.length ? 'Select subcategory' : 'No subcategory available';
    quickAddSubcategoryPicker.appendChild(placeholderOption);

    options.forEach(function (option) {
      let optionElement = document.createElement('option');
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
    let cleanedValue = String(value || '')
      .replace(/,/g, '')
      .trim();
    let parsedValue = Number(cleanedValue);

    if (!cleanedValue || !Number.isFinite(parsedValue) || parsedValue < 0) {
      return NaN;
    }

    return parsedValue;
  }

  function formatNpr(value) {
    let normalizedValue = Math.round(value * 100) / 100;
    let hasDecimal = Math.abs(normalizedValue % 1) > 0;

    return 'NPR ' + normalizedValue.toLocaleString('en-US', {
      minimumFractionDigits: hasDecimal ? 2 : 0,
      maximumFractionDigits: 2,
    });
  }

  function syncQuickAddPricePreview() {
    if (!quickAddMrpInput || !quickAddDiscountInput || !quickAddPricePreview || !quickAddPriceFinal || !quickAddPriceOriginal) {
      return;
    }

    let mrpValue = parsePositiveNumber(quickAddMrpInput.value);
    let discountValue = parsePositiveNumber(quickAddDiscountInput.value);

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
    let discountedValue = mrpValue * ((100 - discountValue) / 100);

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
    syncQuickAddSubcategoryOptions();
  }

  function clearQuickAddCategorySelection() {
    if (quickAddCategoryInput) {
      quickAddCategoryInput.value = '';
    }

    resetSubcategoryInputs();
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
    let globalLoading = window.bdLoading || null;

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
    let parser = null;
    let doc = null;
    let errorAlert = null;
    let warningAlert = null;
    let successAlert = null;
    let extractText = function (node) {
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
    let submitButtons = Array.prototype.slice.call(form.querySelectorAll('button[type="submit"]'));

    if (!submitButtons.length) {
      return;
    }

    submitButtons.forEach(function (button) {
      let defaultLabel = String(button.getAttribute('data-default-label') || '').trim();

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
    clearQuickAddCategorySelection();
    syncQuickAddPricePreview();
    quickAddProductForm.querySelectorAll('[data-file-input]').forEach(function (input) {
      input.dispatchEvent(new Event('change'));
    });
  }

  function toAnchor(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function addProductToOverviewTable(product) {
    let tbody = productOverviewRoot ? productOverviewRoot.querySelector('table tbody') : null;
    let noProductsMsg = productOverviewRoot ? productOverviewRoot.querySelector('[data-product-overview-empty]') : null;
    let tableContainer = productOverviewRoot ? productOverviewRoot.querySelector('[data-product-overview-table]') : null;
    let categoryName = product.categoryName || product.type || 'Other';
    let currentOverviewPath = productOverviewRoot ? String(productOverviewRoot.getAttribute('data-product-overview-path') || '/admin/products').trim() : '/admin/products';

    if (!productOverviewRoot || !product || !product.id) {
      return;
    }

    // If "No products" message exists, remove it and show table
    if (noProductsMsg) {
      noProductsMsg.remove();
      if (tableContainer) {
        tableContainer.classList.remove('hidden');
      }
    }

    if (!tbody) {
      return;
    }

    let row = document.createElement('tr');
    row.className = 'transition-colors hover:bg-slate-50';
    row.innerHTML =
      '<td class="border border-slate-200 px-3 py-2">' +
      '<div class="flex items-center gap-2">' +
      '<img' +
      ' src="' + (product.image || '/images/placeholder.png') + '"' +
      ' alt="' + (product.name || 'Product') + '"' +
      ' class="h-10 w-10 rounded-md border border-slate-200 bg-white object-cover"' +
      ' loading="lazy"' +
      ' />' +
      '<span class="font-semibold text-slate-800">' + (product.name || 'Untitled Product') + '</span>' +
      '</div>' +
      '</td>' +
      '<td class="border border-slate-200 px-3 py-2 font-medium">' + categoryName + '</td>' +
      '<td class="border border-slate-200 px-3 py-2">' + (product.price || 'Contact for price') + '</td>' +
      '<td class="border border-slate-200 px-3 py-2">' + (product.spec || 'N/A') + '</td>' +
      '<td class="border border-slate-200 px-3 py-2">' +
      '<div class="flex flex-wrap items-center gap-2">' +
      '<a' +
      ' href="/admin/categories/' + toAnchor(categoryName) + '"' +
      ' class="pro-btn-secondary px-2.5 py-1 text-xs"' +
      '>' +
      'Open' +
      '</a>' +
      '<button' +
      ' type="button"' +
      ' data-delete-product-trigger="' + product.id + '"' +
      ' data-product-name="' + (product.name || 'this product') + '"' +
      ' class="pro-btn-danger-muted px-2.5 py-1 text-xs"' +
      '>' +
      'Delete' +
      '</button>' +
      '</div>' +
      '<form action="/admin/products/delete" method="post" class="hidden" data-delete-product-form="' + product.id + '">' +
      '<input type="hidden" name="productId" value="' + product.id + '" />' +
      '<input type="hidden" name="redirectTo" value="' + currentOverviewPath + '" />' +
      '</form>' +
      '</td>';

    // Insert at the beginning of tbody
    tbody.insertBefore(row, tbody.firstChild);

    // Bind delete button event
    let deleteBtn = row.querySelector('[data-delete-product-trigger]');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', function () {
        let productKey = deleteBtn.getAttribute('data-delete-product-trigger');
        let productName = deleteBtn.getAttribute('data-product-name') || 'this product';
        let form = document.querySelector('[data-delete-product-form="' + productKey + '"]');

        showDeleteAlert(
          form,
          'Delete Product',
          'Delete "' + productName + '"? This action cannot be undone.'
        );
      });
    }

    // Update product count badge
    let productCountBadge = productOverviewRoot.querySelector('[data-product-overview-count]');
    if (productCountBadge) {
      let currentText = productCountBadge.textContent || '';
      let currentCount = parseInt(currentText.match(/\d+/)?.[0] || '0', 10);
      productCountBadge.textContent = (currentCount + 1) + ' products';
    }
  }

  async function submitQuickAddProductForm(form, activeSubmitter) {
    let response = null;
    let result = null;
    let hasError = false;
    let message = '';

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
      let fetchResult = await fetchAdminJson(form.action, {
        method: 'POST',
        body: new FormData(form),
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json',
        },
      });

      if (fetchResult.redirectedToLogin) {
        return;
      }

      response = fetchResult.response;
      result = fetchResult.payload;

      if (!result || typeof result !== 'object') {
        showToast('error', 'Unexpected server response. Please refresh and try again.');
        return;
      }

      hasError = !isSuccessResponsePayload(result);

      if (hasError) {
        // Handle validation errors (array of errors) or single error message
        if (result.errors && Array.isArray(result.errors) && result.errors.length > 0) {
          message = result.errors.map(function (err) { return err.message; }).join(', ');
        } else {
          message = buildResponseMessage(result, 'Could not save product. Please try again.');
        }
        showToast('error', message);
        return;
      }

      message = buildResponseMessage(result, 'Product saved successfully.');
      showToast('success', message);
      resetQuickAddProductForm();
      // Add product to overview table if returned
      if (result && result.product) {
        addProductToOverviewTable(result.product);
      }
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
    let response = null;
    let result = null;
    let formData = null;
    let urlEncodedData = null;

    if (!form) {
      return;
    }

    setLoadingOverlay(true);

    try {
      formData = new FormData(form);
      urlEncodedData = new URLSearchParams(formData).toString();

      let fetchResult = await fetchAdminJson(form.action, {
        method: 'POST',
        body: urlEncodedData,
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (fetchResult.redirectedToLogin) {
        return;
      }

      response = fetchResult.response;
      result = fetchResult.payload;

      if (!result || typeof result !== 'object') {
        showToast('error', 'Unexpected server response. Please refresh and try again.');
        return;
      }

      if (isSuccessResponsePayload(result)) {
        let productId = form.querySelector('input[name="productId"]')?.value;
        let categoryName = form.querySelector('input[name="categoryName"]')?.value;
        let deleteMessage = categoryName ? 'Category deleted successfully' : (productId ? 'Product deleted successfully' : 'Deleted successfully');
        showToast('success', buildResponseMessage(result, deleteMessage));

        // Remove the deleted product rows immediately (both view and edit rows)
        if (productId) {
          try {
            let viewRow = document.querySelector('[data-view-panel="' + productId + '"]');
            let editRow = document.querySelector('[data-edit-row="' + productId + '"]');
            if (viewRow) viewRow.remove();
            if (editRow) editRow.remove();

            // Also remove any card representation (if present)
            let triggerBtn = document.querySelector('[data-delete-product-trigger="' + productId + '"]');
            if (triggerBtn) {
              let card = triggerBtn.closest('article') || triggerBtn.closest('tr');
              if (card) card.remove();
            }

            // Update product count badges if present
            let productCountBadge = document.querySelector('[data-product-overview-count]') || document.querySelector('[data-managed-product-count-badge]');
            if (productCountBadge) {
              let currentText = productCountBadge.textContent || '';
              let currentCount = parseInt((currentText.match(/\d+/) || ['0'])[0], 10) || 0;
              if (currentCount > 0) {
                productCountBadge.textContent = (currentCount - 1) + ' products';
              }
            }
          } catch (e) {
            // silent fallback — nothing critical if DOM removal fails
          }
        }

        if (categoryName) {
          let categoryKey = categoryName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
          let categoryCard = document.querySelector('[data-delete-category-form="' + categoryKey + '"]')?.closest('article');
          if (categoryCard) {
            categoryCard.remove();
          }
          removeQuickAddCategoryOption(categoryName);
          delete subcategoryOptionsByCategory[categoryKey];
          updateDashboardCategoryCounts();
        }
      } else {
        showToast('error', buildResponseMessage(result, 'Failed to delete'));
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
  clearQuickAddCategorySelection();
  syncQuickAddPricePreview();
  clearAdminFlashQueryParams();

  if (statusTooltip) {
    setTimeout(function () {
      statusTooltip.remove();
    }, 2000);
  }

  document.querySelectorAll('[data-delete-category-trigger]').forEach(function (button) {
    bindDeleteCategoryTrigger(button);
  });

  document.querySelectorAll('[data-delete-product-trigger]').forEach(function (button) {
    button.addEventListener('click', function () {
      let productKey = button.getAttribute('data-delete-product-trigger');
      let productName = button.getAttribute('data-product-name') || 'this product';
      let form = document.querySelector('[data-delete-product-form="' + productKey + '"]');

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
      let submitter = event.submitter && event.submitter.form === quickAddProductForm
        ? event.submitter
        : null;

      event.preventDefault();
      submitQuickAddProductForm(quickAddProductForm, submitter);
    });

    // Handle clear button
    let clearQuickAddBtn = document.querySelector('[data-clear-quick-add]');
    if (clearQuickAddBtn) {
      clearQuickAddBtn.addEventListener('click', function () {
        resetQuickAddProductForm();
        // Hide clear button after reset
        try { updateQuickAddClearButton(); } catch (e) { }
      });
    }

    // Show/hide the clear button when quick-add form becomes dirty
    function isQuickAddFormDirty() {
      if (!quickAddProductForm) return false;
      try {
        let cat = quickAddCategoryInput && String(quickAddCategoryInput.value || '').trim();
        let sub = quickAddSubcategoryPicker && String(quickAddSubcategoryPicker.value || '').trim();
        let mrp = quickAddMrpInput && String(quickAddMrpInput.value || '').trim();
        let qtyEl = quickAddProductForm.querySelector('[name="productQuantity"]');
        let qty = qtyEl ? String(qtyEl.value || '').trim() : '';
        let specEl = quickAddProductForm.querySelector('[name="productSpec"]');
        let spec = specEl ? String(specEl.value || '').trim() : '';
        let fileEl = quickAddProductForm.querySelector('[data-file-input]');
        let hasFile = fileEl && fileEl.files && fileEl.files.length > 0;

        return Boolean(cat || sub || mrp || qty || spec || hasFile);
      } catch (e) {
        return false;
      }
    }

    function updateQuickAddClearButton() {
      if (!clearQuickAddBtn) return;
      try {
        if (isQuickAddFormDirty()) {
          clearQuickAddBtn.classList.remove('hidden');
        } else {
          clearQuickAddBtn.classList.add('hidden');
        }
      } catch (e) { }
    }

    // Wire inputs to toggle the clear button
    if (quickAddProductForm) {
      Array.prototype.slice.call(quickAddProductForm.querySelectorAll('input, select, textarea')).forEach(function (el) {
        el.addEventListener('input', updateQuickAddClearButton);
        el.addEventListener('change', updateQuickAddClearButton);
      });

      // initial state
      try { updateQuickAddClearButton(); } catch (e) { }
    }
  }

  // Handle category create/edit form async
  let categoryForm = document.querySelector('form[action="/admin/categories"]');
  let categoryOriginalNameInput = categoryForm ? categoryForm.querySelector('[data-category-original-name-input]') : null;
  let categoryReplaceItemsInput = categoryForm ? categoryForm.querySelector('[data-category-replace-items-input]') : null;
  let categoryNameInput = categoryForm ? categoryForm.querySelector('[data-category-name-input]') : null;
  let categoryItemsInput = categoryForm ? categoryForm.querySelector('[data-category-items-input]') : null;
  let categorySubmitButton = categoryForm ? categoryForm.querySelector('[data-category-submit-button]') : null;
  let categoryEditCancelButton = categoryForm ? categoryForm.querySelector('[data-category-edit-cancel]') : null;

  function setCategorySubmitButtonLabel(label) {
    let cleanedLabel = String(label || '').trim();

    if (!categorySubmitButton || !cleanedLabel) {
      return;
    }

    categorySubmitButton.textContent = cleanedLabel;
    categorySubmitButton.setAttribute('data-default-label', cleanedLabel);
  }

  function resetCategoryFormToCreateMode() {
    if (categoryOriginalNameInput) {
      categoryOriginalNameInput.value = '';
    }

    if (categoryReplaceItemsInput) {
      categoryReplaceItemsInput.value = '0';
    }

    setCategorySubmitButtonLabel('Save Category');

    if (categoryEditCancelButton) {
      categoryEditCancelButton.classList.add('hidden');
    }
  }

  function setCategoryFormToEditMode(categoryName, categoryItems) {
    if (!categoryForm || !categoryNameInput) {
      return;
    }

    categoryNameInput.value = String(categoryName || '').trim();

    if (categoryItemsInput) {
      categoryItemsInput.value = String(categoryItems || '').trim();
    }

    if (categoryOriginalNameInput) {
      categoryOriginalNameInput.value = String(categoryName || '').trim();
    }

    if (categoryReplaceItemsInput) {
      categoryReplaceItemsInput.value = '1';
    }

    setCategorySubmitButtonLabel('Update Category');

    if (categoryEditCancelButton) {
      categoryEditCancelButton.classList.remove('hidden');
    }

    categoryNameInput.focus();
    categoryForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (categoryEditCancelButton) {
    categoryEditCancelButton.addEventListener('click', function () {
      if (categoryForm) {
        categoryForm.reset();
      }
      resetCategoryFormToCreateMode();
    });
  }

  document.querySelectorAll('[data-edit-category-trigger]').forEach(function (button) {
    bindEditCategoryTrigger(button);
  });

  if (categoryForm) {
    categoryForm.setAttribute('data-skip-global-loading', 'true');
    resetCategoryFormToCreateMode();
    categoryForm.addEventListener('submit', function (event) {
      event.preventDefault();
      submitCategoryFormAsync(categoryForm);
    });
  }

  async function submitCategoryFormAsync(form) {
    let response = null;
    let result = null;
    let formData = null;
    let urlEncodedData = null;

    if (!form || form.getAttribute('data-is-submitting') === '1') {
      return;
    }

    if (typeof form.reportValidity === 'function' && !form.reportValidity()) {
      return;
    }

    form.setAttribute('data-is-submitting', '1');
    setSubmitButtonState(form, true, null);
    setLoadingOverlay(true);

    // Convert FormData to URL-encoded string for proper parsing by express.urlencoded()
    formData = new FormData(form);
    urlEncodedData = new URLSearchParams(formData).toString();

    try {
      let fetchResult = await fetchAdminJson(form.action, {
        method: 'POST',
        body: urlEncodedData,
        credentials: 'same-origin',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          'Accept': 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      if (fetchResult.redirectedToLogin) {
        return;
      }

      response = fetchResult.response;
      result = fetchResult.payload;

      if (!result || typeof result !== 'object') {
        showToast('error', 'Unexpected server response. Please refresh and try again.');
        return;
      }

      if (isSuccessResponsePayload(result)) {
        let resolvedCategoryName = String(result.categoryName || formData.get('categoryName') || '').trim();
        let resolvedOriginalCategoryName = String(result.originalCategoryName || categoryOriginalNameInput && categoryOriginalNameInput.value || '').trim();
        let resolvedCategoryItems = Array.isArray(result.categoryItems)
          ? result.categoryItems
          : parseCategoryItemsInput(formData.get('categoryItems'));

        showToast('success', buildResponseMessage(result, 'Category saved successfully'));
        syncCategorySubcategoryMap(resolvedCategoryName, resolvedCategoryItems, resolvedOriginalCategoryName);
        upsertQuickAddCategoryOption(resolvedCategoryName, resolvedOriginalCategoryName);

        // Ensure quick-add category select contains the new category and sync subcategory picker
        if (quickAddCategoryInput && resolvedCategoryName) {
          let cleanedName = String(resolvedCategoryName || '').trim();
          if (cleanedName) {
            let exists = Array.prototype.slice.call(quickAddCategoryInput.options).some(function (opt) { return String(opt.value || '').trim() === cleanedName; });
            if (!exists) {
              let newOpt = document.createElement('option');
              newOpt.value = cleanedName;
              newOpt.textContent = cleanedName;
              quickAddCategoryInput.appendChild(newOpt);
              // keep options sorted
              sortQuickAddCategoryOptions();
            }

            // Select the newly created/updated category so the quick-add flow is ready
            try {
              quickAddCategoryInput.value = cleanedName;
              syncQuickAddSubcategoryOptions();
            } catch (e) {
              // ignore
            }
          }
        }

        if (categoryForm && categoryForm.hasAttribute('data-category-form')) {
          upsertDashboardCategoryCard(resolvedCategoryName, resolvedCategoryItems, resolvedOriginalCategoryName);
        }

        form.reset();
        resetCategoryFormToCreateMode();

        if (!categoryForm || !categoryForm.hasAttribute('data-category-form')) {
          // Follow the backend redirect when a rename changes the category slug.
          setTimeout(function () {
            let redirectPath = result && result.redirectPath ? String(result.redirectPath).trim() : '';

            if (redirectPath) {
              window.location.assign(redirectPath);
              return;
            }

            window.location.reload();
          }, 800);
        }
      } else {
        showToast('error', buildResponseMessage(result, 'Failed to save category'));
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
