const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const userSavedViewSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    ownerUserId: { type: Number, required: true, index: true },
    pageKey: { type: String, required: true, trim: true, index: true },
    name: { type: String, required: true, trim: true, index: true },
    config: { type: Schema.Types.Mixed, required: true, default: {} },
    createdAt: requiredDateField(),
    updatedAt: requiredDateField({ index: true }),
  },
  {
    versionKey: false,
  }
);

userSavedViewSchema.index({ ownerUserId: 1, pageKey: 1, name: 1 }, { unique: true });

module.exports = models.UserSavedView || model("UserSavedView", userSavedViewSchema);
