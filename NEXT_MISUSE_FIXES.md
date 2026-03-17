# `next()` Misuse Fixes

This repo had a few places where `next()` was used outside of Express middleware (controllers and Mongoose hooks). That pattern is a common cause of runtime errors like:

`TypeError: next is not a function`

Below are the fixes applied, with before/after snippets and the reason for each change.

## Fix 1: `lib/asyncHandler.js` (standardize wrapper)

### BEFORE
```js
function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    return Promise.resolve(handler(req, res, next)).catch(err => {
      if (typeof next === 'function') {
        next(err);
      } else {
        console.error('Unhandled error:', err);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
      }
    });
  };
};

export default asyncHandler;
```

### AFTER
```js
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

export default asyncHandler;
```

### WHY
- You required `asyncHandler` to match a specific implementation exactly.
- The previous wrapper tried to be defensive when `next` was missing by sending a JSON 500 itself, which can hide the real bug and can cause double-response problems if headers were already sent.
- This wrapper must only be used as Express middleware. If an `asyncHandler(...)`-wrapped function is invoked manually without Express providing `next`, `.catch(next)` will trigger `TypeError: next is not a function`.

## Fix 2: `controllers/publicController.js` (remove `next()` from controllers)

### BEFORE
```js
async function renderHomePage(req, res, next) {
  try {
    catalog = await catalogService.getCatalogContext();
    // ...
  } catch (error) {
    return next(error);
  }
  // ...
}

async function renderProductDetail(req, res, next) {
  // ...
  if (!productMatch) {
    return next();
  }
  // ...
}

async function renderOrderPage(req, res, next) {
  // ...
  if (!productId) {
    return next();
  }
  // ...
  if (!productMatch || !productMatch.item) {
    return next();
  }
  // ...
}
```

### AFTER
```js
import createError from 'http-errors';

async function renderHomePage(req, res) {
  catalog = await catalogService.getCatalogContext();
  // ...
}

async function renderProductDetail(req, res) {
  // ...
  if (!productMatch) {
    throw createError(404);
  }
  // ...
}

async function renderOrderPage(req, res) {
  // ...
  if (!productId) {
    throw createError(404);
  }
  // ...
  if (!productMatch || !productMatch.item) {
    throw createError(404);
  }
  // ...
}
```

### WHY
- These handlers are mounted using `asyncHandler(...)` in `routes/index.js`, so they should not call `next()` directly.
- Calling `next()` inside controllers becomes a footgun if the controller is ever invoked outside Express (or invoked with the wrong arg order), producing `TypeError: next is not a function`.
- For "not found" flows, `throw createError(404)` is explicit and works cleanly with `asyncHandler` + the app's error handler.

## Fix 3: `models/Product.js` (remove callback-style `next()` hooks)

### BEFORE
```js
productSchema.pre('findOneAndUpdate', function (next) {
  try {
    applyQuantityUpdateGuards.call(this);
    next();
  } catch (error) {
    next(error);
  }
});

productSchema.pre('updateOne', function (next) {
  try {
    applyQuantityUpdateGuards.call(this);
    next();
  } catch (error) {
    next(error);
  }
});

productSchema.pre('updateMany', function (next) {
  try {
    applyQuantityUpdateGuards.call(this);
    next();
  } catch (error) {
    next(error);
  }
});
```

### AFTER
```js
['findOneAndUpdate', 'updateOne', 'updateMany'].forEach((hook) => {
  productSchema.pre(hook, async function () {
    applyQuantityUpdateGuards.call(this);
  });
});
```

### WHY
- You required that database utilities (including model hooks) not call `next()` and instead throw errors.
- The callback-style hooks were redundant because the async pre-hooks already existed for the same operations.
- Throwing from the pre-hook cleanly fails the update without relying on callback plumbing.

## Fix 4: `models/Brand.js` (remove callback-style `next()` hook)

### BEFORE
```js
brandSchema.pre('validate', function (next) {
  this.name = toTrimmedString(this.name);
  this.normalizedName = normalizeName(this.name);
  this.slug = slugify(this.name || this.slug);
  next();
});
```

### AFTER
```js
brandSchema.pre('validate', function () {
  this.name = toTrimmedString(this.name);
  this.normalizedName = normalizeName(this.name);
  this.slug = slugify(this.name || this.slug);
});
```

### WHY
- Same rule: no `next()` usage in database utilities.
- Mongoose supports synchronous pre-hooks without a `next` callback; throwing is enough to fail validation.
