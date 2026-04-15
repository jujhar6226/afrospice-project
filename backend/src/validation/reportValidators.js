const {
  ensureObject,
  readOptionalString,
  readPositiveInteger,
  readRequiredString,
  throwValidationError,
} = require("./helpers");

const ALLOWED_REPORT_RANGES = ["daily", "weekly", "monthly", "yearly"];
const ALLOWED_HISTORY_ROLES = ["user", "assistant", "system"];

function validateReportRange(value, fallback = "monthly") {
  const normalized = readOptionalString(value, {
    label: "Report range",
    maxLength: 20,
    defaultValue: fallback,
    transform: (item) => item.toLowerCase(),
  });

  if (!ALLOWED_REPORT_RANGES.includes(normalized)) {
    throwValidationError(`Report range must be one of: ${ALLOWED_REPORT_RANGES.join(", ")}.`);
  }

  return normalized;
}

function validateOwnerAssistantPayload(payload) {
  const body = ensureObject(payload);
  const historyInput = Array.isArray(body.history) ? body.history : [];

  if (historyInput.length > 20) {
    throwValidationError("Conversation history cannot contain more than 20 messages.");
  }

  const history = historyInput.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throwValidationError(`History item ${index + 1} must be a valid message object.`);
    }

    const role = readRequiredString(entry.role, `History item ${index + 1} role`, {
      maxLength: 20,
      transform: (item) => item.toLowerCase(),
    });

    if (!ALLOWED_HISTORY_ROLES.includes(role)) {
      throwValidationError(
        `History item ${index + 1} role must be one of: ${ALLOWED_HISTORY_ROLES.join(", ")}.`
      );
    }

    return {
      role,
      content: readRequiredString(entry.content, `History item ${index + 1} content`, {
        maxLength: 4000,
      }),
    };
  });

  return {
    question: readRequiredString(body.question, "Question", {
      maxLength: 2000,
    }),
    history,
  };
}

function validateMachineForecastQuery(query = {}, fallbackRange = "daily") {
  const range = validateReportRange(query.range, fallbackRange);
  const fallbackHorizon =
    range === "daily" ? 14 : range === "weekly" ? 8 : range === "monthly" ? 4 : 2;
  const maxHorizon =
    range === "daily" ? 30 : range === "weekly" ? 12 : range === "monthly" ? 6 : 4;
  const horizon =
    query.horizon === undefined || query.horizon === null || query.horizon === ""
      ? fallbackHorizon
      : readPositiveInteger(query.horizon, "Forecast horizon");

  if (horizon > maxHorizon) {
    throwValidationError(`Forecast horizon for ${range} reports cannot exceed ${maxHorizon}.`);
  }

  const limit =
    query.limit === undefined || query.limit === null || query.limit === ""
      ? 8
      : readPositiveInteger(query.limit, "Forecast SKU limit");

  if (limit > 12) {
    throwValidationError("Forecast SKU limit cannot exceed 12.");
  }

  return {
    range,
    horizon,
    limit,
  };
}

module.exports = {
  validateReportRange,
  validateOwnerAssistantPayload,
  validateMachineForecastQuery,
};
