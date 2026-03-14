(function () {
  let sidebar = document.getElementById('mobile-category-sidebar');
  let layoutGrid = null;
  let productsGrid = null;
  let siteNav = document.getElementById('site-navbar');
  let openBtn = document.getElementById('mobile-sidebar-open');
  let closeBtn = document.getElementById('mobile-sidebar-close');
  let openBtnOpenIcon = openBtn ? openBtn.querySelector('[data-sidebar-toggle-icon-open]') : null;
  let openBtnCloseIcon = openBtn ? openBtn.querySelector('[data-sidebar-toggle-icon-close]') : null;
  let backdrop = document.getElementById('mobile-sidebar-backdrop');
  let mobileOpenBodyClass = 'mobile-sidebar-open';
  let desktopStorageKey = 'bhutandevi-desktop-sidebar-collapsed';
  let desktopCollapsed = false;

  if (!sidebar || !openBtn || !backdrop) {
    return;
  }

  function isDesktopViewport() {
    return window.matchMedia('(min-width: 1024px)').matches;
  }

  function applyMobileSidebarLayout() {
    sidebar.style.top = '0';
    sidebar.style.height = '100vh';
    sidebar.style.height = '100dvh';
  }

  function clearMobileSidebarLayout() {
    sidebar.style.removeProperty('top');
    sidebar.style.removeProperty('height');
  }

  function resolveDesktopLayoutTargets() {
    if (!layoutGrid) {
      layoutGrid = document.getElementById('home-layout-grid');
    }

    if (!productsGrid) {
      productsGrid = document.getElementById('products-grid');
    }
  }

  function readDesktopPreference() {
    try {
      return window.localStorage.getItem(desktopStorageKey) === '1';
    } catch (error) {
      return false;
    }
  }

  function saveDesktopPreference(collapsed) {
    try {
      window.localStorage.setItem(desktopStorageKey, collapsed ? '1' : '0');
    } catch (error) {
      // Ignore storage errors.
    }
  }

  function setToggleButtonState(isOpen) {
    openBtn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    openBtn.setAttribute('aria-label', isOpen ? 'Close categories' : 'Open categories');

    if (openBtnOpenIcon && openBtnCloseIcon) {
      openBtnOpenIcon.classList.toggle('hidden', isOpen);
      openBtnCloseIcon.classList.toggle('hidden', !isOpen);
    }
  }

  function setMobileNavVisibility(isOpen) {
    if (!siteNav) {
      return;
    }

    if (isDesktopViewport()) {
      siteNav.style.removeProperty('transform');
      siteNav.style.removeProperty('pointer-events');
      return;
    }

    if (isOpen) {
      siteNav.style.transform = 'translateY(-100%)';
      siteNav.style.pointerEvents = 'none';
      return;
    }

    siteNav.style.transform = 'translateY(0)';
    siteNav.style.removeProperty('pointer-events');
  }

  function setMobileOpenState(isOpen) {
    document.body.classList.toggle('overflow-hidden', isOpen);
    document.body.classList.toggle(mobileOpenBodyClass, isOpen);
    setMobileNavVisibility(isOpen);
  }

  function openMobileSidebar() {
    if (isDesktopViewport()) {
      return;
    }

    sidebar.classList.remove('-translate-x-full');
    sidebar.classList.remove('opacity-0', 'pointer-events-none');
    backdrop.classList.remove('opacity-0', 'pointer-events-none');
    setMobileOpenState(true);
    setToggleButtonState(true);
  }

  function closeMobileSidebar() {
    sidebar.classList.add('-translate-x-full');
    sidebar.classList.add('opacity-0', 'pointer-events-none');
    backdrop.classList.add('opacity-0', 'pointer-events-none');
    setMobileOpenState(false);
    setToggleButtonState(false);
  }

  function applyDesktopSidebarLayout() {
    clearMobileSidebarLayout();
    backdrop.classList.add('opacity-0', 'pointer-events-none');
    setMobileOpenState(false);
    sidebar.classList.remove('-translate-x-full');
    sidebar.classList.remove('opacity-0', 'pointer-events-none');
    setToggleButtonState(!desktopCollapsed);
    resolveDesktopLayoutTargets();

    if (desktopCollapsed) {
      sidebar.classList.add('lg:hidden');
    } else {
      sidebar.classList.remove('lg:hidden');
    }

    if (layoutGrid) {
      layoutGrid.style.transition = 'grid-template-columns 240ms var(--pro-ease-soft)';
      layoutGrid.style.gridTemplateColumns = desktopCollapsed ? 'minmax(0, 1fr)' : '20rem minmax(0, 1fr)';
    }

    if (productsGrid) {
      productsGrid.style.transition = 'grid-template-columns 240ms var(--pro-ease-soft)';
      productsGrid.style.gridTemplateColumns = desktopCollapsed ? 'repeat(4, minmax(0, 1fr))' : 'repeat(3, minmax(0, 1fr))';
    }
  }

  function clearDesktopSidebarLayout() {
    sidebar.classList.remove('lg:hidden');
    resolveDesktopLayoutTargets();

    if (layoutGrid) {
      layoutGrid.style.removeProperty('grid-template-columns');
      layoutGrid.style.removeProperty('transition');
    }

    if (productsGrid) {
      productsGrid.style.removeProperty('grid-template-columns');
      productsGrid.style.removeProperty('transition');
    }
  }

  function syncSidebarMode() {
    if (isDesktopViewport()) {
      applyDesktopSidebarLayout();
      return;
    }

    applyMobileSidebarLayout();
    clearDesktopSidebarLayout();
    closeMobileSidebar();
  }

  function toggleSidebar(event) {
    if (event) {
      event.preventDefault();
    }

    if (isDesktopViewport()) {
      desktopCollapsed = !desktopCollapsed;
      saveDesktopPreference(desktopCollapsed);
      applyDesktopSidebarLayout();
      return;
    }

    if (sidebar.classList.contains('-translate-x-full')) {
      openMobileSidebar();
      return;
    }

    closeMobileSidebar();
  }

  openBtn.addEventListener('click', toggleSidebar);

  if (closeBtn) {
    closeBtn.addEventListener('click', function (event) {
      event.preventDefault();
      closeMobileSidebar();
    });
  }

  backdrop.addEventListener('click', function (event) {
    event.preventDefault();
    closeMobileSidebar();
  });

  sidebar.querySelectorAll('a').forEach(function (link) {
    link.addEventListener('click', function () {
      if (!isDesktopViewport()) {
        closeMobileSidebar();
      }
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !isDesktopViewport() && !sidebar.classList.contains('-translate-x-full')) {
      closeMobileSidebar();
    }
  });

  desktopCollapsed = readDesktopPreference();
  window.addEventListener('resize', syncSidebarMode);
  document.addEventListener('DOMContentLoaded', syncSidebarMode);
  syncSidebarMode();

  let items = sidebar.querySelectorAll('[data-category-accordion-item]');
  items.forEach(function (item) {
    item.addEventListener('toggle', function () {
      if (!item.open) {
        return;
      }

      items.forEach(function (other) {
        if (other !== item) {
          other.open = false;
        }
      });
    });
  });
})();
