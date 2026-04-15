const { Schema, model, models } = require("mongoose");
const { optionalDateField, requiredDateField } = require("./dateFields");

const purchaseOrderItemSchema = new Schema(
  {
    id: { type: Number, required: true },
    productId: { type: Number, required: true, index: true },
    productName: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true },
    qtyOrdered: { type: Number, required: true, default: 0 },
    qtyReceived: { type: Number, required: true, default: 0 },
    unitCost: { type: Number, required: true, default: 0 },
    status: { type: String, required: true, default: "Open", trim: true },
    createdAt: requiredDateField(),
    updatedAt: requiredDateField(),
  },
  {
    _id: false,
  }
);

const purchaseOrderSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, trim: true, index: true },
    supplierId: { type: Number, default: null, index: true },
    supplier: { type: String, required: true, default: "General Supplier", trim: true },
    status: { type: String, required: true, default: "Draft", trim: true, index: true },
    note: { type: String, default: "", trim: true },
    createdBy: { type: String, default: "", trim: true },
    createdAt: requiredDateField({ index: true }),
    updatedAt: requiredDateField(),
    expectedDate: optionalDateField(),
    sentAt: optionalDateField(),
    receivedAt: optionalDateField(),
    totalEstimatedCost: { type: Number, required: true, default: 0 },
    items: { type: [purchaseOrderItemSchema], required: true, default: [] },
  },
  {
    versionKey: false,
  }
);

module.exports = models.PurchaseOrder || model("PurchaseOrder", purchaseOrderSchema);
