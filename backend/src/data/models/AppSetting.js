const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const appSettingSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, default: 1 },
    storeName: { type: String, required: true, trim: true },
    currency: { type: String, required: true, trim: true },
    taxRate: { type: Number, required: true, default: 0 },
    receiptFooter: { type: String, required: true, default: "", trim: true },
    notifications: { type: Boolean, required: true, default: true },
    autoPrintReceipt: { type: Boolean, required: true, default: false },
    lowStockThreshold: { type: Number, required: true, default: 10 },
    managerName: { type: String, required: true, default: "", trim: true },
    enableDiscounts: { type: Boolean, required: true, default: true },
    requirePinForRefunds: { type: Boolean, required: true, default: true },
    showStockWarnings: { type: Boolean, required: true, default: true },
    salesEmailReports: { type: Boolean, required: true, default: false },
    compactTables: { type: Boolean, required: true, default: false },
    dashboardAnimations: { type: Boolean, required: true, default: true },
    quickCheckout: { type: Boolean, required: true, default: true },
    soundEffects: { type: Boolean, required: true, default: false },
    branchCode: { type: String, required: true, default: "", trim: true },
    supportEmail: { type: String, required: true, default: "", trim: true },
    supportPhone: { type: String, required: true, default: "", trim: true },
    domain: { type: String, required: true, default: "", trim: true },
    timeZone: { type: String, required: true, default: "America/Toronto", trim: true },
    defaultReportsView: { type: String, required: true, default: "Monthly", trim: true },
    autoLockMinutes: { type: Number, required: true, default: 30 },
    billingPlan: { type: String, required: true, default: "Premium", trim: true },
    billingProvider: { type: String, required: true, default: "Manual", trim: true },
    billingContactEmail: { type: String, required: true, default: "", trim: true },
    billingNextBillingDate: { type: String, required: true, default: "", trim: true },
    billingAutoCharge: { type: Boolean, required: true, default: false },
    customerDiscountMode: { type: String, required: true, default: "policy", trim: true },
    defaultCustomerDiscountPct: { type: Number, required: true, default: 5 },
    vipCustomerDiscountPct: { type: Number, required: true, default: 10 },
    maxAutoDiscountPct: { type: Number, required: true, default: 15 },
    aiDiscountSuggestions: { type: Boolean, required: true, default: true },
    apiAccessEnabled: { type: Boolean, required: true, default: false },
    apiEnvironmentLabel: { type: String, required: true, default: "Protected", trim: true },
    updatedAt: requiredDateField(),
  },
  {
    versionKey: false,
  }
);

module.exports = models.AppSetting || model("AppSetting", appSettingSchema);
