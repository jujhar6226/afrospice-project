const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const customerSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    name: { type: String, required: true, unique: true, trim: true },
    email: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
    loyaltyOptIn: { type: Boolean, required: true, default: false },
    marketingOptIn: { type: Boolean, required: true, default: false },
    preferredContactMethod: { type: String, default: "None", trim: true },
    loyaltyEnrolledAt: { type: Date, default: null },
    isWalkIn: { type: Boolean, required: true, default: false },
    createdAt: requiredDateField(),
    updatedAt: requiredDateField(),
  },
  {
    versionKey: false,
  }
);

module.exports = models.Customer || model("Customer", customerSchema);
