function asyncHandler(handler) {
  return function wrappedHandler(req, res, next) {
    return Promise.resolve()
      .then(function () {
        return handler(req, res, next);
      })
      .catch(next);
  };
}
export default asyncHandler;
