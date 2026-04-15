const {
  ensureObject,
  readOptionalEmail,
  readOptionalString,
  readRequiredString,
  throwValidationError,
} = require("./helpers");

function readOptionalBoolean(value, fieldLabel, defaultValue = false) {
  if (value === undefined) {
    return Boolean(defaultValue);
  }

  if (typeof value === "boolean") {
    return value;
  }

  throwValidationError(`${fieldLabel} must be true or false.`);
}

function validateSupplierListQuery(query = {}) {
  if (query === null || query === undefined || Array.isArray(query) || typeof query !== "object") {
    throwValidationError("A valid supplier query is required.");
  }

  return {
    search: readOptionalString(query.search, {
      label: "Supplier search",
      maxLength: 120,
      defaultValue: "",
    }),
  };
}

function validateSupplierPayload(payload) {
  const body = ensureObject(payload);

  return {
    name: readRequiredString(body.name, "Supplier name", {
      maxLength: 120,
    }),
    contactName: readOptionalString(body.contactName, {
      label: "Supplier contact name",
      maxLength: 120,
      defaultValue: "",
    }),
    email: readOptionalEmail(body.email, "Supplier email"),
    phone: readOptionalString(body.phone, {
      label: "Supplier phone",
      maxLength: 40,
      defaultValue: "",
    }),
    notes: readOptionalString(body.notes, {
      label: "Supplier notes",
      maxLength: 240,
      defaultValue: "",
    }),
    isActive: readOptionalBoolean(body.isActive, "Supplier active flag", true),
  };
}

module.exports = {
  validateSupplierListQuery,
  validateSupplierPayload,
};
