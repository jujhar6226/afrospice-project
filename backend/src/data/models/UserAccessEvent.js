const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const userAccessEventSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    userId: { type: Number, default: null, index: true },
    staffId: { type: String, required: true, default: "", trim: true, index: true },
    fullName: { type: String, required: true, default: "", trim: true },
    eventType: { type: String, required: true, default: "", trim: true, index: true },
    title: { type: String, required: true, default: "", trim: true },
    message: { type: String, required: true, default: "", trim: true },
    actorName: { type: String, required: true, default: "", trim: true },
    createdAt: requiredDateField({ index: true }),
  },
  {
    versionKey: false,
  }
);

module.exports = models.UserAccessEvent || model("UserAccessEvent", userAccessEventSchema);
