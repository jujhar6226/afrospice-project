const {
  ensureObject,
  readRequiredString,
  throwValidationError,
} = require("./helpers");

function validateLoginPayload(payload) {
  const body = ensureObject(payload);
  const staffId = readRequiredString(body.staffId, "Staff ID", {
    maxLength: 32,
    transform: (value) => value.toUpperCase(),
  });
  const pin = readRequiredString(body.pin, "PIN", {
    minLength: 4,
    maxLength: 6,
  });

  if (!/^[A-Z0-9-]+$/.test(staffId)) {
    throwValidationError("Staff ID contains invalid characters.");
  }

  if (!/^\d{4,6}$/.test(pin)) {
    throwValidationError("PIN must be 4-6 digits.");
  }

  return {
    staffId,
    pin,
  };
}

function validateChangePinPayload(payload) {
  const body = ensureObject(payload);
  const currentPin = readRequiredString(body.currentPin, "Current PIN", {
    minLength: 4,
    maxLength: 6,
  });
  const nextPin = readRequiredString(body.nextPin, "New PIN", {
    minLength: 4,
    maxLength: 6,
  });
  const confirmPin = readRequiredString(body.confirmPin, "PIN confirmation", {
    minLength: 4,
    maxLength: 6,
  });

  if (!/^\d{4,6}$/.test(currentPin) || !/^\d{4,6}$/.test(nextPin) || !/^\d{4,6}$/.test(confirmPin)) {
    throwValidationError("PIN values must be 4-6 digits.");
  }

  if (nextPin !== confirmPin) {
    throwValidationError("PIN confirmation does not match.");
  }

  return {
    currentPin,
    nextPin,
    confirmPin,
  };
}

module.exports = {
  validateLoginPayload,
  validateChangePinPayload,
};
