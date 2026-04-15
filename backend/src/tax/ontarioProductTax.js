const ONTARIO_HST_RATE = 13;

const TAX_CLASS_DEFINITIONS = Object.freeze({
  ZERO_RATED_GROCERY: {
    code: "CA-ON-GROCERY-ZERO",
    label: "Basic grocery",
    rate: 0,
  },
  HST_STANDARD: {
    code: "CA-ON-HST13",
    label: "Ontario HST",
    rate: ONTARIO_HST_RATE,
  },
  HST_SOFT_DRINK: {
    code: "CA-ON-HST13-SOFT-DRINK",
    label: "Taxable soft drink",
    rate: ONTARIO_HST_RATE,
  },
  HST_SNACK: {
    code: "CA-ON-HST13-SNACK",
    label: "Taxable snack food",
    rate: ONTARIO_HST_RATE,
  },
  HST_PREPARED_FOOD: {
    code: "CA-ON-HST13-PREPARED",
    label: "Taxable prepared food",
    rate: ONTARIO_HST_RATE,
  },
});

const VALID_PRODUCT_TAX_CLASSES = Object.freeze(Object.keys(TAX_CLASS_DEFINITIONS));

function normalizeLookup(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const PRODUCT_TAX_CLASS_OVERRIDES = new Map([
  ["jollof rice mix", "ZERO_RATED_GROCERY"],
  ["palm oil", "ZERO_RATED_GROCERY"],
  ["basmati rice 5kg", "ZERO_RATED_GROCERY"],
  ["semolina flour", "ZERO_RATED_GROCERY"],
  ["cassava flour", "ZERO_RATED_GROCERY"],
  ["tomato paste", "ZERO_RATED_GROCERY"],
  ["cooking salt", "ZERO_RATED_GROCERY"],
  ["sugar 2kg", "ZERO_RATED_GROCERY"],
  ["peanut butter", "ZERO_RATED_GROCERY"],
  ["coke pack", "HST_SOFT_DRINK"],
  ["bottled water 24pk", "ZERO_RATED_GROCERY"],
  ["orange juice", "ZERO_RATED_GROCERY"],
  ["milo tin", "ZERO_RATED_GROCERY"],
  ["milk powder", "ZERO_RATED_GROCERY"],
  ["butter spread", "ZERO_RATED_GROCERY"],
  ["egg tray", "ZERO_RATED_GROCERY"],
  ["bread loaf", "ZERO_RATED_GROCERY"],
  ["meat pie pack", "HST_PREPARED_FOOD"],
  ["plantain chips", "HST_SNACK"],
  ["groundnut mix", "HST_SNACK"],
  ["frozen chicken", "ZERO_RATED_GROCERY"],
  ["beef strips", "ZERO_RATED_GROCERY"],
]);

const CATEGORY_TAX_CLASS_DEFAULTS = new Map([
  ["food staples", "ZERO_RATED_GROCERY"],
  ["cooking essentials", "ZERO_RATED_GROCERY"],
  ["groceries", "ZERO_RATED_GROCERY"],
  ["dairy", "ZERO_RATED_GROCERY"],
  ["bakery", "ZERO_RATED_GROCERY"],
  ["meat & protein", "ZERO_RATED_GROCERY"],
  ["snacks", "HST_SNACK"],
  ["drinks", "HST_SOFT_DRINK"],
]);

function isKnownProductTaxClass(value) {
  return VALID_PRODUCT_TAX_CLASSES.includes(String(value || "").trim());
}

function normalizeStoredTaxClass(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return isKnownProductTaxClass(normalized) ? normalized : "";
}

function deriveProductTaxClass(product = {}) {
  const manualTaxClass = normalizeStoredTaxClass(product.taxClass);
  if (manualTaxClass) return manualTaxClass;

  const explicitNameMatch = PRODUCT_TAX_CLASS_OVERRIDES.get(normalizeLookup(product.name));
  if (explicitNameMatch) return explicitNameMatch;

  const categoryMatch = CATEGORY_TAX_CLASS_DEFAULTS.get(normalizeLookup(product.category));
  if (categoryMatch) return categoryMatch;

  return "HST_STANDARD";
}

function getTaxDefinition(taxClass) {
  return TAX_CLASS_DEFINITIONS[deriveProductTaxClass({ taxClass })] || TAX_CLASS_DEFINITIONS.HST_STANDARD;
}

function getProductTaxProfile(product = {}) {
  const explicitTaxClass = normalizeStoredTaxClass(product.taxClass);
  const taxClass = deriveProductTaxClass(product);
  const definition = getTaxDefinition(taxClass);

  return {
    taxClass,
    taxCode: definition.code,
    taxLabel: definition.label,
    taxRate: Number(definition.rate || 0),
    isTaxable: Number(definition.rate || 0) > 0,
    taxSource: explicitTaxClass ? "manual" : "derived",
    taxClassOverride: explicitTaxClass,
  };
}

function calculateTaxAmount(amount, taxRate) {
  return Number(((Number(amount || 0) * Number(taxRate || 0)) / 100).toFixed(2));
}

module.exports = {
  ONTARIO_HST_RATE,
  TAX_CLASS_DEFINITIONS,
  VALID_PRODUCT_TAX_CLASSES,
  calculateTaxAmount,
  deriveProductTaxClass,
  getProductTaxProfile,
  isKnownProductTaxClass,
  normalizeStoredTaxClass,
};
