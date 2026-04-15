const AppError = require("../errors/AppError");

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function throwValidationError(message, details = null) {
  throw new AppError(400, message, {
    code: "VALIDATION_ERROR",
    details,
  });
}

function ensureObject(value, message = "A valid request body is required.") {
  if (!isPlainObject(value)) {
    throwValidationError(message);
  }

  return value;
}

function readRequiredString(value, fieldLabel, options = {}) {
  const normalized = compactText(value);

  if (!normalized) {
    throwValidationError(`${fieldLabel} is required.`);
  }

  if (options.minLength && normalized.length < options.minLength) {
    throwValidationError(`${fieldLabel} must be at least ${options.minLength} characters.`);
  }

  if (options.maxLength && normalized.length > options.maxLength) {
    throwValidationError(`${fieldLabel} must be ${options.maxLength} characters or fewer.`);
  }

  return typeof options.transform === "function" ? options.transform(normalized) : normalized;
}

function readOptionalString(value, options = {}) {
  const normalized = compactText(value);

  if (!normalized) {
    return options.defaultValue ?? "";
  }

  if (options.maxLength && normalized.length > options.maxLength) {
    throwValidationError(
      `${options.label || "Field"} must be ${options.maxLength} characters or fewer.`
    );
  }

  return typeof options.transform === "function" ? options.transform(normalized) : normalized;
}

function readPositiveInteger(value, fieldLabel) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throwValidationError(`${fieldLabel} must be a positive whole number.`);
  }

  return parsed;
}

function readOptionalPositiveInteger(value, fieldLabel, defaultValue = null) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return defaultValue;
  }

  return readPositiveInteger(value, fieldLabel);
}

function readNonNegativeInteger(value, fieldLabel) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throwValidationError(`${fieldLabel} must be a non-negative whole number.`);
  }

  return parsed;
}

function readPositiveNumber(value, fieldLabel) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throwValidationError(`${fieldLabel} must be greater than zero.`);
  }

  return Number(parsed.toFixed(2));
}

function readNonNegativeNumber(value, fieldLabel) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throwValidationError(`${fieldLabel} must be zero or greater.`);
  }

  return Number(parsed.toFixed(2));
}

function readEnum(value, fieldLabel, allowedValues, defaultValue = null) {
  const normalized = compactText(value);
  const candidate = normalized || defaultValue;

  if (!candidate || !allowedValues.includes(candidate)) {
    throwValidationError(`${fieldLabel} must be one of: ${allowedValues.join(", ")}.`);
  }

  return candidate;
}

function readBoolean(value, defaultValue = false) {
  if (value === undefined) {
    return Boolean(defaultValue);
  }

  return Boolean(value);
}

function readOptionalEmail(value, fieldLabel, defaultValue = "") {
  const normalized = readOptionalString(value, {
    label: fieldLabel,
    maxLength: 120,
    transform: (item) => item.toLowerCase(),
    defaultValue,
  });

  if (!normalized) {
    return normalized;
  }

  if (!EMAIL_REGEX.test(normalized)) {
    throwValidationError(`${fieldLabel} must be a valid email address.`);
  }

  return normalized;
}

function assertCondition(condition, message, statusCode = 400, details = null) {
  if (!condition) {
    throw new AppError(statusCode, message, {
      code: statusCode >= 500 ? "APP_ERROR" : "BUSINESS_RULE_VIOLATION",
      details,
    });
  }
}

module.exports = {
  compactText,
  ensureObject,
  throwValidationError,
  readRequiredString,
  readOptionalString,
  readPositiveInteger,
  readOptionalPositiveInteger,
  readNonNegativeInteger,
  readPositiveNumber,
  readNonNegativeNumber,
  readEnum,
  readBoolean,
  readOptionalEmail,
  assertCondition,
};
