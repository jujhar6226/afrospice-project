const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const supplierSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true, unique: true, trim: true },
    contactName: { type: String, default: "", trim: true },
    email: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
    isActive: { type: Boolean, required: true, default: true, index: true },
    createdAt: requiredDateField(),
    updatedAt: requiredDateField(),
  },
  {
    versionKey: false,
  }
);

module.exports = models.Supplier || model("Supplier", supplierSchema);
