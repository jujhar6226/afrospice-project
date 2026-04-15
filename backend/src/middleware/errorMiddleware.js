const AppError = require("../errors/AppError");

function notFoundHandler(req, res) {
  return res.status(404).json({
    success: false,
    message: "Route not found.",
    path: req.originalUrl,
  });
}

function errorHandler(err, req, res, next) {
  const normalizedError =
    err instanceof AppError
      ? err
      : new AppError(Number(err?.statusCode) || 500, err?.message || "Server error.", {
          code: err?.code || "UNEXPECTED_ERROR",
          details: err?.details ?? null,
          expose: Number(err?.statusCode) < 500,
        });

  const statusCode = Number(normalizedError.statusCode) || 500;
  const isClientError = statusCode >= 400 && statusCode < 500;

  if (isClientError) {
    console.warn("Request rejected:", {
      code: normalizedError.code,
      message: normalizedError.message,
      path: req.originalUrl,
      method: req.method,
    });
  } else {
    console.error("Error:", {
      name: normalizedError.name,
      code: normalizedError.code,
      message: normalizedError.message,
      details: normalizedError.details,
      stack: err?.stack || normalizedError.stack,
      path: req.originalUrl,
      method: req.method,
    });
  }

  return res.status(statusCode).json({
    success: false,
    message:
      normalizedError.expose && normalizedError.message
        ? normalizedError.message
        : "An unexpected server error occurred.",
    ...(normalizedError.details ? { details: normalizedError.details } : {}),
    ...(normalizedError.code ? { code: normalizedError.code } : {}),
  });
}

module.exports = {
  notFoundHandler,
  errorHandler,
};
