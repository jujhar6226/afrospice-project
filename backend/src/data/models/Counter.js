const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const counterSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    seq: { type: Number, required: true, default: 0 },
    createdAt: requiredDateField(),
    updatedAt: requiredDateField(),
  },
  {
    versionKey: false,
  }
);

module.exports = models.Counter || model("Counter", counterSchema);
