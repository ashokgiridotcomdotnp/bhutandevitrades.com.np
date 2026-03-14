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

    if (!categoriesButton || !sidebarOpenButton) {
      return;
    }

    categoriesButton.addEventListener('click', function () {
      sidebarOpenButton.click();
    });
  }

  initUserMenu();
  initCategoryScrollArrow();
  initMobileNavAutoHide();
  initMobileBottomNav();
})();
