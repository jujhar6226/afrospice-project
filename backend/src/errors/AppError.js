class AppError extends Error {
  constructor(statusCode, message, options = {}) {
    super(message);
    this.name = "AppError";
    this.statusCode = Number(statusCode) || 500;
    this.code = String(options.code || "APP_ERROR").trim() || "APP_ERROR";
    this.details = options.details ?? null;
    this.expose = options.expose ?? this.statusCode < 500;
  }
}

module.exports = AppError;
