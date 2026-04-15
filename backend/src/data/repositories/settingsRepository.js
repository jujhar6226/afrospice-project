const defaultSettings = require("../defaultSettings");
const models = require("../models");
const { safeDate, toIsoTimestamp } = require("./mongoRepositoryUtils");

function normalizeSettings(row) {
  const { _id, ...persisted } = row || {};
  const updatedAt = persisted.updatedAt ? toIsoTimestamp(persisted.updatedAt) : new Date().toISOString();
  const currency = String(persisted.currency ?? defaultSettings.currency).trim().toUpperCase();
  const timeZone = String(persisted.timeZone ?? defaultSettings.timeZone).trim();

  return {
    ...defaultSettings,
    ...persisted,
    currency: currency === "USD" ? defaultSettings.currency : currency || defaultSettings.currency,
    taxRate: Number(persisted.taxRate ?? defaultSettings.taxRate),
    lowStockThreshold: Number(persisted.lowStockThreshold ?? defaultSettings.lowStockThreshold),
    notifications: persisted.notifications ?? defaultSettings.notifications,
    autoPrintReceipt: persisted.autoPrintReceipt ?? defaultSettings.autoPrintReceipt,
    enableDiscounts: persisted.enableDiscounts ?? defaultSettings.enableDiscounts,
    requirePinForRefunds: persisted.requirePinForRefunds ?? defaultSettings.requirePinForRefunds,
    showStockWarnings: persisted.showStockWarnings ?? defaultSettings.showStockWarnings,
    salesEmailReports: persisted.salesEmailReports ?? defaultSettings.salesEmailReports,
    compactTables: persisted.compactTables ?? defaultSettings.compactTables,
    dashboardAnimations: persisted.dashboardAnimations ?? defaultSettings.dashboardAnimations,
    quickCheckout: persisted.quickCheckout ?? defaultSettings.quickCheckout,
    soundEffects: persisted.soundEffects ?? defaultSettings.soundEffects,
    domain: persisted.domain ?? defaultSettings.domain,
    timeZone: timeZone === "UTC" ? defaultSettings.timeZone : timeZone || defaultSettings.timeZone,
    defaultReportsView: persisted.defaultReportsView ?? defaultSettings.defaultReportsView,
    autoLockMinutes: Number(
      persisted.autoLockMinutes ?? defaultSettings.autoLockMinutes
    ),
    billingPlan: persisted.billingPlan ?? defaultSettings.billingPlan,
    billingProvider: persisted.billingProvider ?? defaultSettings.billingProvider,
    billingContactEmail:
      persisted.billingContactEmail ?? defaultSettings.billingContactEmail,
    billingNextBillingDate:
      persisted.billingNextBillingDate ?? defaultSettings.billingNextBillingDate,
    billingAutoCharge:
      persisted.billingAutoCharge ?? defaultSettings.billingAutoCharge,
    customerDiscountMode:
      persisted.customerDiscountMode ?? defaultSettings.customerDiscountMode,
    defaultCustomerDiscountPct: Number(
      persisted.defaultCustomerDiscountPct ?? defaultSettings.defaultCustomerDiscountPct
    ),
    vipCustomerDiscountPct: Number(
      persisted.vipCustomerDiscountPct ?? defaultSettings.vipCustomerDiscountPct
    ),
    maxAutoDiscountPct: Number(
      persisted.maxAutoDiscountPct ?? defaultSettings.maxAutoDiscountPct
    ),
    aiDiscountSuggestions:
      persisted.aiDiscountSuggestions ?? defaultSettings.aiDiscountSuggestions,
    apiAccessEnabled:
      persisted.apiAccessEnabled ?? defaultSettings.apiAccessEnabled,
    apiEnvironmentLabel:
      persisted.apiEnvironmentLabel ?? defaultSettings.apiEnvironmentLabel,
    updatedAt,
  };
}

async function getAppSettings() {
  const row = await models.AppSetting.findOne({ id: 1 }).lean();
  return normalizeSettings(row);
}

async function updateAppSettings(patch = {}) {
  const nextSettings = {
    ...(await getAppSettings()),
    ...(patch || {}),
  };
  const updatedAt = safeDate(nextSettings.updatedAt) || new Date();

  await models.AppSetting.updateOne(
    { id: 1 },
    {
      $set: {
        id: 1,
        storeName: String(nextSettings.storeName || defaultSettings.storeName).trim(),
        currency: String(nextSettings.currency || defaultSettings.currency).trim(),
        taxRate: Number(nextSettings.taxRate ?? defaultSettings.taxRate),
        receiptFooter: String(nextSettings.receiptFooter || defaultSettings.receiptFooter).trim(),
        notifications: Boolean(nextSettings.notifications),
        autoPrintReceipt: Boolean(nextSettings.autoPrintReceipt),
        lowStockThreshold: Number(nextSettings.lowStockThreshold ?? defaultSettings.lowStockThreshold),
        managerName: String(nextSettings.managerName || defaultSettings.managerName).trim(),
        enableDiscounts: Boolean(nextSettings.enableDiscounts),
        requirePinForRefunds: Boolean(nextSettings.requirePinForRefunds),
        showStockWarnings: Boolean(nextSettings.showStockWarnings),
        salesEmailReports: Boolean(nextSettings.salesEmailReports),
        compactTables: Boolean(nextSettings.compactTables),
        dashboardAnimations: Boolean(nextSettings.dashboardAnimations),
        quickCheckout: Boolean(nextSettings.quickCheckout),
        soundEffects: Boolean(nextSettings.soundEffects),
        branchCode: String(nextSettings.branchCode || defaultSettings.branchCode).trim(),
        supportEmail: String(nextSettings.supportEmail || defaultSettings.supportEmail).trim(),
        supportPhone: String(nextSettings.supportPhone || defaultSettings.supportPhone).trim(),
        domain: String(nextSettings.domain || defaultSettings.domain).trim().toLowerCase(),
        timeZone: String(nextSettings.timeZone || defaultSettings.timeZone).trim(),
        defaultReportsView: String(
          nextSettings.defaultReportsView || defaultSettings.defaultReportsView
        ).trim(),
        autoLockMinutes: Number(
          nextSettings.autoLockMinutes ?? defaultSettings.autoLockMinutes
        ),
        billingPlan: String(nextSettings.billingPlan || defaultSettings.billingPlan).trim(),
        billingProvider: String(
          nextSettings.billingProvider || defaultSettings.billingProvider
        ).trim(),
        billingContactEmail: String(
          nextSettings.billingContactEmail || defaultSettings.billingContactEmail
        ).trim(),
        billingNextBillingDate: String(
          nextSettings.billingNextBillingDate || defaultSettings.billingNextBillingDate
        ).trim(),
        billingAutoCharge: Boolean(nextSettings.billingAutoCharge),
        customerDiscountMode: String(
          nextSettings.customerDiscountMode || defaultSettings.customerDiscountMode
        ).trim(),
        defaultCustomerDiscountPct: Number(
          nextSettings.defaultCustomerDiscountPct ?? defaultSettings.defaultCustomerDiscountPct
        ),
        vipCustomerDiscountPct: Number(
          nextSettings.vipCustomerDiscountPct ?? defaultSettings.vipCustomerDiscountPct
        ),
        maxAutoDiscountPct: Number(
          nextSettings.maxAutoDiscountPct ?? defaultSettings.maxAutoDiscountPct
        ),
        aiDiscountSuggestions: Boolean(nextSettings.aiDiscountSuggestions),
        apiAccessEnabled: Boolean(nextSettings.apiAccessEnabled),
        apiEnvironmentLabel: String(
          nextSettings.apiEnvironmentLabel || defaultSettings.apiEnvironmentLabel
        ).trim(),
        updatedAt,
      },
    },
    { upsert: true }
  );

  return getAppSettings();
}

module.exports = {
  getAppSettings,
  updateAppSettings,
};
