const {
  ensureObject,
  readOptionalString,
  readOptionalEmail,
  readNonNegativeNumber,
  readNonNegativeInteger,
  readBoolean,
  readEnum,
  throwValidationError,
} = require("./helpers");

function validateSettingsPatch(payload) {
  const body = ensureObject(payload);
  const patch = {};

  const supportedKeys = new Set([
    "storeName",
    "currency",
    "taxRate",
    "receiptFooter",
    "notifications",
    "autoPrintReceipt",
    "lowStockThreshold",
    "managerName",
    "enableDiscounts",
    "requirePinForRefunds",
    "showStockWarnings",
    "salesEmailReports",
    "compactTables",
    "dashboardAnimations",
    "quickCheckout",
    "soundEffects",
    "branchCode",
    "supportEmail",
    "supportPhone",
    "domain",
    "timeZone",
    "defaultReportsView",
    "autoLockMinutes",
    "billingPlan",
    "billingProvider",
    "billingContactEmail",
    "billingNextBillingDate",
    "billingAutoCharge",
    "customerDiscountMode",
    "defaultCustomerDiscountPct",
    "vipCustomerDiscountPct",
    "maxAutoDiscountPct",
    "aiDiscountSuggestions",
    "apiAccessEnabled",
    "apiEnvironmentLabel",
  ]);

  Object.keys(body).forEach((key) => {
    if (!supportedKeys.has(key)) {
      throwValidationError(`Unsupported settings field: ${key}.`);
    }
  });

  if (body.storeName !== undefined) {
    patch.storeName = readOptionalString(body.storeName, {
      label: "Store name",
      maxLength: 120,
    });
  }

  if (body.currency !== undefined) {
    patch.currency = readOptionalString(body.currency, {
      label: "Currency",
      maxLength: 8,
      transform: (value) => value.toUpperCase(),
    });
  }

  if (body.taxRate !== undefined) {
    patch.taxRate = readNonNegativeNumber(body.taxRate, "Tax rate");
  }

  if (body.receiptFooter !== undefined) {
    patch.receiptFooter = readOptionalString(body.receiptFooter, {
      label: "Receipt footer",
      maxLength: 240,
    });
  }

  if (body.lowStockThreshold !== undefined) {
    patch.lowStockThreshold = readNonNegativeInteger(body.lowStockThreshold, "Low-stock threshold");
  }

  if (body.managerName !== undefined) {
    patch.managerName = readOptionalString(body.managerName, {
      label: "Manager name",
      maxLength: 120,
    });
  }

  if (body.branchCode !== undefined) {
    patch.branchCode = readOptionalString(body.branchCode, {
      label: "Branch code",
      maxLength: 40,
    });
  }

  if (body.supportEmail !== undefined) {
    patch.supportEmail = readOptionalEmail(body.supportEmail, "Support email");
  }

  if (body.supportPhone !== undefined) {
    patch.supportPhone = readOptionalString(body.supportPhone, {
      label: "Support phone",
      maxLength: 40,
    });
  }

  if (body.domain !== undefined) {
    patch.domain = readOptionalString(body.domain, {
      label: "Domain",
      maxLength: 120,
      transform: (value) => value.toLowerCase(),
    });
  }

  if (body.timeZone !== undefined) {
    patch.timeZone = readOptionalString(body.timeZone, {
      label: "Time zone",
      maxLength: 80,
    });
  }

  if (body.defaultReportsView !== undefined) {
    patch.defaultReportsView = readEnum(
      body.defaultReportsView,
      "Default reports view",
      ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly"],
      "Monthly"
    );
  }

  if (body.autoLockMinutes !== undefined) {
    patch.autoLockMinutes = readNonNegativeInteger(body.autoLockMinutes, "Auto-lock minutes");
  }

  if (body.billingPlan !== undefined) {
    patch.billingPlan = readEnum(
      body.billingPlan,
      "Billing plan",
      ["Starter", "Growth", "Premium", "Enterprise"],
      "Premium"
    );
  }

  if (body.billingProvider !== undefined) {
    patch.billingProvider = readEnum(
      body.billingProvider,
      "Billing provider",
      ["Manual", "Stripe", "Square", "Paystack"],
      "Manual"
    );
  }

  if (body.billingContactEmail !== undefined) {
    patch.billingContactEmail = readOptionalEmail(body.billingContactEmail, "Billing contact email");
  }

  if (body.billingNextBillingDate !== undefined) {
    patch.billingNextBillingDate = readOptionalString(body.billingNextBillingDate, {
      label: "Next billing date",
      maxLength: 20,
    });
  }

  if (body.customerDiscountMode !== undefined) {
    patch.customerDiscountMode = readEnum(
      body.customerDiscountMode,
      "Customer discount mode",
      ["manual", "policy", "guided"],
      "policy"
    );
  }

  if (body.defaultCustomerDiscountPct !== undefined) {
    patch.defaultCustomerDiscountPct = readNonNegativeNumber(
      body.defaultCustomerDiscountPct,
      "Default customer discount percentage"
    );
  }

  if (body.vipCustomerDiscountPct !== undefined) {
    patch.vipCustomerDiscountPct = readNonNegativeNumber(
      body.vipCustomerDiscountPct,
      "VIP customer discount percentage"
    );
  }

  if (body.maxAutoDiscountPct !== undefined) {
    patch.maxAutoDiscountPct = readNonNegativeNumber(
      body.maxAutoDiscountPct,
      "Maximum automatic discount percentage"
    );
  }

  if (body.apiEnvironmentLabel !== undefined) {
    patch.apiEnvironmentLabel = readOptionalString(body.apiEnvironmentLabel, {
      label: "API environment label",
      maxLength: 40,
    });
  }

  [
    "notifications",
    "autoPrintReceipt",
    "enableDiscounts",
    "requirePinForRefunds",
    "showStockWarnings",
    "salesEmailReports",
    "compactTables",
    "dashboardAnimations",
    "quickCheckout",
    "soundEffects",
    "billingAutoCharge",
    "aiDiscountSuggestions",
    "apiAccessEnabled",
  ].forEach((key) => {
    if (body[key] !== undefined) {
      patch[key] = readBoolean(body[key]);
    }
  });

  return patch;
}

module.exports = {
  validateSettingsPatch,
};
