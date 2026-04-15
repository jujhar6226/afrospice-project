const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const productSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    sku: { type: String, required: true, unique: true, trim: true },
    barcode: { type: String, default: "", trim: true, index: true },
    price: { type: Number, required: true, default: 0 },
    unitCost: { type: Number, required: true, default: 0 },
    stock: { type: Number, required: true, default: 0 },
    category: { type: String, required: true, default: "General", trim: true, index: true },
    supplierId: { type: Number, default: null, index: true },
    supplier: { type: String, required: true, default: "General Supplier", trim: true },
    taxClass: { type: String, default: "", trim: true, index: true },
    createdAt: requiredDateField(),
    updatedAt: requiredDateField(),
  },
  {
    versionKey: false,
  }
);

module.exports = models.Product || model("Product", productSchema);
