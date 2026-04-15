const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const inventoryMovementSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    productId: { type: Number, required: true, index: true },
    productName: { type: String, default: "", trim: true },
    sku: { type: String, default: "", trim: true },
    movementType: { type: String, required: true, default: "adjustment", trim: true },
    quantityDelta: { type: Number, required: true, default: 0 },
    quantityBefore: { type: Number, default: null },
    quantityAfter: { type: Number, default: null },
    referenceType: { type: String, default: "", trim: true },
    referenceId: { type: String, default: "", trim: true },
    note: { type: String, default: "", trim: true },
    actorName: { type: String, default: "", trim: true },
    createdAt: requiredDateField({ index: true }),
  },
  {
    versionKey: false,
  }
);

module.exports = models.InventoryMovement || model("InventoryMovement", inventoryMovementSchema);
