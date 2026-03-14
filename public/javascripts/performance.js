(function () {
  let IMAGE_READY_CLASS = 'is-loaded';
  let IMAGE_LOADING_CLASS = 'is-loading';
  let IMAGE_SKELETON_CLASS = 'bd-image-skeleton';
  let IMAGE_PROCESSED_ATTR = 'data-bd-image-ready';

  function shouldSkipImage(image) {
    let src = String(image.getAttribute('src') || '').trim();
    let widthAttr = Number(image.getAttribute('width'));
    let heightAttr = Number(image.getAttribute('height'));

    if (!src) {
      return true;
    }

    if (src.indexOf('/icons/') === 0) {
      return true;
    }

    if (src.indexOf('data:image') === 0) {
      return true;
    }

    if (image.classList.contains('bd-footer-social-icon')) {
      return true;
    }

    if ((Number.isFinite(widthAttr) && widthAttr > 0 && widthAttr <= 40) || (Number.isFinite(heightAttr) && heightAttr > 0 && heightAttr <= 40)) {
      return true;
    }

    return false;
  }

  function shouldLazyLoadImage(image) {
    let rect = image.getBoundingClientRect();
    let viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    if (image.hasAttribute('data-force-eager')) {
      return false;
    }

    if (image.closest('[data-home-carousel]')) {
      return false;
    }

    if (rect.width <= 0 && rect.height <= 0) {
      return true;
    }

    return rect.top > (viewportHeight * 1.15);
  }

  function markImageReady(image) {
    image.classList.remove(IMAGE_LOADING_CLASS);
    image.classList.add(IMAGE_READY_CLASS);
  }

  function prepareImage(image) {
    let didResolve = false;

    if (!image || image.getAttribute(IMAGE_PROCESSED_ATTR) === '1') {
      return;
    }

    image.setAttribute(IMAGE_PROCESSED_ATTR, '1');

    if (shouldSkipImage(image)) {
      if (!image.hasAttribute('decoding')) {
        image.setAttribute('decoding', 'async');
      }
      return;
    }

    if (!image.hasAttribute('decoding')) {
      image.setAttribute('decoding', 'async');
    }

    if (!image.hasAttribute('loading')) {
      image.setAttribute('loading', shouldLazyLoadImage(image) ? 'lazy' : 'eager');
    }

    image.classList.add(IMAGE_SKELETON_CLASS);
    image.classList.add(IMAGE_LOADING_CLASS);

    if (image.complete && image.naturalWidth > 0) {
      markImageReady(image);
      return;
    }

    function resolve() {
      if (didResolve) {
        return;
      }

      didResolve = true;
      markImageReady(image);
      image.removeEventListener('load', resolve);
      image.removeEventListener('error', resolve);
    }

    image.addEventListener('load', resolve);
    image.addEventListener('error', resolve);
    window.setTimeout(resolve, 2600);
  }

  function optimizeImages(rootElement) {
    let scope = rootElement && typeof rootElement.querySelectorAll === 'function' ? rootElement : document;
    let images = scope.querySelectorAll('img');

    if (!images.length) {
      return;
    }

    images.forEach(function (image) {
      prepareImage(image);
    });
  }

  document.documentElement.classList.add('js-enabled');
  window.bdOptimizeImages = optimizeImages;
  optimizeImages(document);
})();
