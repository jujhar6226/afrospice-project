const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const saleItemSchema = new Schema(
  {
    id: { type: Number, required: true, index: true },
    name: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true },
    qty: { type: Number, required: true, default: 0 },
    price: { type: Number, required: true, default: 0 },
    unitCost: { type: Number, required: true, default: 0 },
    taxClass: { type: String, default: "", trim: true },
    taxCode: { type: String, default: "", trim: true },
    taxLabel: { type: String, default: "", trim: true },
    taxRate: { type: Number, required: true, default: 0 },
    isTaxable: { type: Boolean, required: true, default: false },
    discountPercent: { type: Number, required: true, default: 0 },
    discountAmount: { type: Number, required: true, default: 0 },
    lineBaseSubtotal: { type: Number, required: true, default: 0 },
    lineSubtotal: { type: Number, required: true, default: 0 },
    taxAmount: { type: Number, required: true, default: 0 },
    lineTotal: { type: Number, required: true, default: 0 },
    lineGrossTotal: { type: Number, required: true, default: 0 },
    createdAt: requiredDateField(),
    updatedAt: requiredDateField(),
  },
  {
    _id: false,
  }
);

const saleSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, trim: true, index: true },
    preDiscountSubtotal: { type: Number, required: true, default: 0 },
    discount: { type: Number, required: true, default: 0 },
    subtotal: { type: Number, required: true, default: 0 },
    tax: { type: Number, required: true, default: 0 },
    total: { type: Number, required: true, default: 0 },
    cashierUserId: { type: Number, default: null, index: true },
    cashier: { type: String, required: true, default: "Front Desk", trim: true },
    customerId: { type: Number, default: null, index: true },
    customer: { type: String, required: true, default: "Walk-in Customer", trim: true },
    customerDiscountPercent: { type: Number, required: true, default: 0 },
    customerLoyaltyTier: { type: String, default: "", trim: true },
    customerLoyaltyNumber: { type: String, default: "", trim: true },
    status: { type: String, required: true, default: "Pending", trim: true, index: true },
    channel: { type: String, required: true, default: "In-Store", trim: true },
    paymentMethod: { type: String, required: true, default: "Card", trim: true },
    date: requiredDateField({ index: true }),
    createdAt: requiredDateField(),
    updatedAt: requiredDateField({ index: true }),
    items: { type: [saleItemSchema], required: true, default: [] },
  },
  {
    versionKey: false,
  }
);

module.exports = models.Sale || model("Sale", saleSchema);
