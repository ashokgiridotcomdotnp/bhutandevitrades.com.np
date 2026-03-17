(function () {
  function initUserMenu() {
    let menuRoots = document.querySelectorAll('[data-user-menu-root]');

    if (!menuRoots.length) {
      return;
    }

    function closeMenu(root) {
      let toggleButton = root.querySelector('[data-user-menu-toggle]');
      let menuPanel = root.querySelector('[data-user-menu-panel]');

      if (!toggleButton || !menuPanel) {
        return;
      }

      menuPanel.classList.add('hidden');
      toggleButton.setAttribute('aria-expanded', 'false');
    }

    function closeAllMenus() {
      menuRoots.forEach(function (root) {
        closeMenu(root);
      });
    }

    menuRoots.forEach(function (root) {
      let toggleButton = root.querySelector('[data-user-menu-toggle]');
      let menuPanel = root.querySelector('[data-user-menu-panel]');

      if (!toggleButton || !menuPanel) {
        return;
      }

      toggleButton.addEventListener('click', function (event) {
        event.preventDefault();
        let isClosed = menuPanel.classList.contains('hidden');

        closeAllMenus();

        if (isClosed) {
          menuPanel.classList.remove('hidden');
          toggleButton.setAttribute('aria-expanded', 'true');
        }
      });
    });

    document.addEventListener('click', function (event) {
      let clickedInsideMenu = false;

      menuRoots.forEach(function (root) {
        if (root.contains(event.target)) {
          clickedInsideMenu = true;
        }
      });

      if (!clickedInsideMenu) {
        closeAllMenus();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closeAllMenus();
      }
    });
  }

  function initCategoryScrollArrow() {
    let categoriesScroller = document.querySelector('[data-nav-categories-scroller]');
    let categoriesNextButton = document.querySelector('[data-nav-categories-next]');

    if (!categoriesScroller || !categoriesNextButton) {
      return;
    }

    function hasMoreCategoriesOnRight() {
      return categoriesScroller.scrollLeft + categoriesScroller.clientWidth < categoriesScroller.scrollWidth - 4;
    }

    function syncCategoriesArrow() {
      if (hasMoreCategoriesOnRight()) {
        categoriesNextButton.classList.remove('hidden');
      } else {
        categoriesNextButton.classList.add('hidden');
      }
    }

    categoriesNextButton.addEventListener('click', function (event) {
      event.preventDefault();
      let scrollDistance = Math.max(120, Math.round(categoriesScroller.clientWidth * 0.72));
      categoriesScroller.scrollBy({
        left: scrollDistance,
        behavior: 'smooth',
      });
    });

    categoriesScroller.addEventListener('scroll', syncCategoriesArrow, { passive: true });
    window.addEventListener('resize', syncCategoriesArrow);
    syncCategoriesArrow();
  }

  function initMobileNavAutoHide() {
    let nav = document.getElementById('site-navbar');
    let lastScrollY = window.scrollY || 0;
    let isHidden = false;
    let isTicking = false;
    let minScrollDelta = 8;
    let revealOffset = 12;

    if (!nav) {
      return;
    }

    nav.style.transition = nav.style.transition || 'transform 280ms ease, box-shadow 280ms ease';
    nav.style.willChange = 'transform';

    function isMobileViewport() {
      return window.matchMedia('(max-width: 1023px)').matches;
    }

    function showNav() {
      if (!isHidden) {
        return;
      }

      nav.style.transform = 'translateY(0)';
      isHidden = false;
    }

    function hideNav() {
      if (isHidden) {
        return;
      }

      nav.style.transform = 'translateY(-100%)';
      isHidden = true;
    }

    function syncNavVisibility() {
      let currentScrollY = window.scrollY || 0;
      let scrollDelta = currentScrollY - lastScrollY;

      isTicking = false;

      if (!isMobileViewport()) {
        showNav();
        lastScrollY = currentScrollY;
        return;
      }

      if (currentScrollY <= revealOffset) {
        showNav();
        lastScrollY = currentScrollY;
        return;
      }

      if (Math.abs(scrollDelta) < minScrollDelta) {
        return;
      }

      if (scrollDelta > 0) {
        hideNav();
      } else {
        showNav();
      }

      lastScrollY = currentScrollY;
    }

    function handleScroll() {
      if (isTicking) {
        return;
      }

      isTicking = true;
      window.requestAnimationFrame(syncNavVisibility);
    }

    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', function () {
      showNav();
      lastScrollY = window.scrollY || 0;
    });

    showNav();
  }

  function initMobileBottomNav() {
    let mobileBottomNav = document.querySelector('[data-mobile-bottom-nav]');
    let categoriesButton = document.getElementById('mobile-nav-categories');
    let sidebarOpenButton = document.getElementById('mobile-sidebar-open');

    document.body.classList.toggle('has-mobile-bottom-nav', Boolean(mobileBottomNav));

    function syncBottomNavHeight() {
      if (!mobileBottomNav) {
        document.documentElement.style.removeProperty('--mobile-bottom-nav-height');
        return;
      }

      let height = mobileBottomNav.getBoundingClientRect().height;
      if (!Number.isFinite(height) || height <= 0) {
        return;
      }

      document.documentElement.style.setProperty('--mobile-bottom-nav-height', Math.round(height) + 'px');
    }

    syncBottomNavHeight();
    window.addEventListener('resize', syncBottomNavHeight);

    if (!categoriesButton || !sidebarOpenButton) {
      return;
    }

    categoriesButton.addEventListener('click', function () {
      sidebarOpenButton.click();
    });
  }

  function initMobileSearchPanel() {
    let openButton = document.getElementById('mobile-nav-search');
    let panel = document.getElementById('mobile-search-panel');
    let closeButton = document.getElementById('mobile-search-close');
    let backdrop = document.getElementById('mobile-search-backdrop');

    if (!openButton || !panel || !closeButton || !backdrop) {
      return;
    }

    let isOpen = false;
    let input = panel.querySelector('input[name="q"]');
    let visualViewport = window.visualViewport || null;

    function isMobileViewport() {
      return window.matchMedia('(max-width: 1023px)').matches;
    }

    function getKeyboardInset() {
      if (!visualViewport) {
        return 0;
      }

      let inset = window.innerHeight - visualViewport.height - visualViewport.offsetTop;
      if (!Number.isFinite(inset)) {
        return 0;
      }

      return Math.max(0, Math.round(inset));
    }

    function syncPanelPosition() {
      if (!isOpen) {
        panel.style.removeProperty('bottom');
        return;
      }

      let keyboardInset = getKeyboardInset();

      if (keyboardInset > 0) {
        panel.style.bottom = keyboardInset + 'px';
        return;
      }

      panel.style.removeProperty('bottom');
    }

    function syncBodyScrollLock() {
      let shouldLockScroll = isOpen;
      document.body.classList.toggle('overflow-hidden', shouldLockScroll);
    }

    function openPanel() {
      if (!isMobileViewport() || isOpen) {
        return;
      }

      isOpen = true;
      panel.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-3');
      backdrop.classList.remove('opacity-0', 'pointer-events-none');
      openButton.setAttribute('aria-expanded', 'true');
      syncBodyScrollLock();
      syncPanelPosition();

      if (input) {
        window.requestAnimationFrame(function () {
          input.focus();
          input.select();
          syncPanelPosition();
        });
      }
    }

    function closePanel() {
      if (!isOpen) {
        return;
      }

      isOpen = false;
      panel.classList.add('opacity-0', 'pointer-events-none', 'translate-y-3');
      backdrop.classList.add('opacity-0', 'pointer-events-none');
      openButton.setAttribute('aria-expanded', 'false');
      syncBodyScrollLock();
      syncPanelPosition();
    }

    function togglePanel(event) {
      if (event) {
        event.preventDefault();
      }

      if (isOpen) {
        closePanel();
        return;
      }

      openPanel();
    }

    openButton.addEventListener('click', togglePanel);
    closeButton.addEventListener('click', function (event) {
      event.preventDefault();
      closePanel();
    });
    backdrop.addEventListener('click', function (event) {
      event.preventDefault();
      closePanel();
    });

    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        closePanel();
      }
    });

    if (visualViewport) {
      visualViewport.addEventListener('resize', syncPanelPosition);
      visualViewport.addEventListener('scroll', syncPanelPosition);
    }

    window.addEventListener('resize', function () {
      if (!isMobileViewport()) {
        closePanel();
      }
    });
  }

  initUserMenu();
  initCategoryScrollArrow();
  initMobileNavAutoHide();
  initMobileSearchPanel();
  initMobileBottomNav();
})();
