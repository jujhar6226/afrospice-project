const {
  ensureObject,
  readBoolean,
  readEnum,
  readOptionalEmail,
  readOptionalString,
  readRequiredString,
  throwValidationError,
} = require("./helpers");

const CONTACT_METHODS = ["None", "Phone", "Email", "SMS"];

function validateCustomerListQuery(query = {}) {
  if (query === null || query === undefined || Array.isArray(query) || typeof query !== "object") {
    throwValidationError("A valid customer query is required.");
  }

  return {
    search: readOptionalString(query.search, {
      label: "Customer search",
      maxLength: 120,
      defaultValue: "",
    }),
  };
}

function validateCustomerPayload(payload) {
  const body = ensureObject(payload);

  return {
    name: readRequiredString(body.name, "Customer name", {
      maxLength: 120,
    }),
    email: readOptionalEmail(body.email, "Customer email"),
    phone: readOptionalString(body.phone, {
      label: "Customer phone",
      maxLength: 40,
      defaultValue: "",
    }),
    notes: readOptionalString(body.notes, {
      label: "Customer notes",
      maxLength: 240,
      defaultValue: "",
    }),
    loyaltyOptIn: readBoolean(body.loyaltyOptIn, false),
    marketingOptIn: readBoolean(body.marketingOptIn, false),
    preferredContactMethod: readEnum(
      body.preferredContactMethod,
      "Preferred contact method",
      CONTACT_METHODS,
      "None"
    ),
  };
}

module.exports = {
  validateCustomerListQuery,
  validateCustomerPayload,
};
