const REQUIRED_DATE_FIELD = Object.freeze({
  type: Date,
  required: true,
  default: Date.now,
});

const OPTIONAL_DATE_FIELD = Object.freeze({
  type: Date,
  default: null,
});

function requiredDateField(options = {}) {
  return {
    ...REQUIRED_DATE_FIELD,
    ...options,
  };
}

function optionalDateField(options = {}) {
  return {
    ...OPTIONAL_DATE_FIELD,
    ...options,
  };
}

module.exports = {
  requiredDateField,
  optionalDateField,
};
