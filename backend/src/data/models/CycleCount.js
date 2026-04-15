const { Schema, model, models } = require("mongoose");
const { optionalDateField, requiredDateField } = require("./dateFields");

const cycleCountItemSchema = new Schema(
  {
    id: { type: Number, required: true },
    productId: { type: Number, required: true, index: true },
    productName: { type: String, required: true, trim: true },
    sku: { type: String, required: true, trim: true },
    expectedQty: { type: Number, required: true, default: 0 },
    countedQty: { type: Number, default: null },
    varianceQty: { type: Number, default: null },
    status: { type: String, required: true, default: "Pending", trim: true },
    createdAt: requiredDateField(),
    updatedAt: requiredDateField(),
  },
  {
    _id: false,
  }
);

const cycleCountSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, trim: true, index: true },
    status: { type: String, required: true, default: "Open", trim: true, index: true },
    note: { type: String, default: "", trim: true },
    createdBy: { type: String, default: "", trim: true },
    createdAt: requiredDateField({ index: true }),
    updatedAt: requiredDateField(),
    completedAt: optionalDateField(),
    items: { type: [cycleCountItemSchema], required: true, default: [] },
  },
  {
    versionKey: false,
  }
);

module.exports = models.CycleCount || model("CycleCount", cycleCountSchema);
