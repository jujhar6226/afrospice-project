const {
  ensureObject,
  readRequiredString,
  readOptionalString,
  readPositiveNumber,
  readNonNegativeNumber,
  readNonNegativeInteger,
  readPositiveInteger,
  throwValidationError,
} = require("./helpers");
const { VALID_PRODUCT_TAX_CLASSES } = require("../tax/ontarioProductTax");

function validateProductPayload(payload) {
  const body = ensureObject(payload);
  const hasTaxClass = Object.prototype.hasOwnProperty.call(body, "taxClass");
  const taxClass = hasTaxClass
    ? readOptionalString(body.taxClass, {
        label: "Tax class",
        maxLength: 48,
        transform: (value) => value.toUpperCase(),
      })
    : undefined;

  if (taxClass && !VALID_PRODUCT_TAX_CLASSES.includes(taxClass)) {
    throwValidationError(`Tax class must be one of: ${VALID_PRODUCT_TAX_CLASSES.join(", ")}.`);
  }

  return {
    name: readRequiredString(body.name, "Product name", {
      maxLength: 120,
    }),
    sku: readRequiredString(body.sku, "SKU", {
      maxLength: 64,
      transform: (value) => value.toUpperCase(),
    }),
    barcode: readOptionalString(body.barcode, {
      label: "Barcode",
      maxLength: 64,
    }),
    price: readPositiveNumber(body.price, "Price"),
    unitCost: readNonNegativeNumber(body.unitCost ?? 0, "Unit cost"),
    stock: readNonNegativeInteger(body.stock ?? 0, "Stock quantity"),
    category: readRequiredString(body.category, "Category", {
      maxLength: 80,
    }),
    supplier: readOptionalString(body.supplier, {
      label: "Supplier",
      maxLength: 120,
      defaultValue: "",
    }),
    ...(hasTaxClass ? { taxClass } : {}),
  };
}

function validateRestockPayload(payload) {
  const body = ensureObject(payload);

  return {
    amount: readPositiveInteger(body.amount, "Restock amount"),
    note: readOptionalString(body.note, {
      label: "Restock note",
      maxLength: 240,
      defaultValue: "",
    }),
  };
}

module.exports = {
  validateProductPayload,
  validateRestockPayload,
};
