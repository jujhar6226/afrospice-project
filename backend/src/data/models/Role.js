const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const roleSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, unique: true, trim: true },
    description: { type: String, required: true, default: "", trim: true },
    createdAt: requiredDateField(),
    updatedAt: requiredDateField(),
  },
  {
    versionKey: false,
  }
);

module.exports = models.Role || model("Role", roleSchema);
