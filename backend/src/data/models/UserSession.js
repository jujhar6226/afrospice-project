const { Schema, model, models } = require("mongoose");
const { optionalDateField, requiredDateField } = require("./dateFields");

const userSessionSchema = new Schema(
  {
    id: { type: String, required: true, unique: true, trim: true, index: true },
    userId: { type: Number, required: true, index: true },
    staffId: { type: String, required: true, default: "", trim: true },
    fullName: { type: String, required: true, default: "", trim: true },
    status: { type: String, required: true, default: "Active", trim: true, index: true },
    loginAt: requiredDateField({ index: true }),
    lastSeenAt: requiredDateField(),
    logoutAt: optionalDateField(),
    loginReason: { type: String, default: "", trim: true },
    logoutReason: { type: String, default: "", trim: true },
  },
  {
    versionKey: false,
  }
);

module.exports = models.UserSession || model("UserSession", userSessionSchema);
