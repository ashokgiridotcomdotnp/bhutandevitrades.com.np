function AppError(statusCode, code, message, details) {
  this.name = 'AppError';
  this.statusCode = Number.isFinite(statusCode) ? statusCode : 500;
  this.code = String(code || 'internal-error');
  this.message = String(message || 'Unexpected error');
  this.details = details || null;
  Error.captureStackTrace(this, AppError);
}

AppError.prototype = Object.create(Error.prototype);
AppError.prototype.constructor = AppError;

function isAppError(error) {
  return Boolean(error) && error instanceof AppError;
}
export default {
  AppError: AppError,
  isAppError: isAppError,
};
