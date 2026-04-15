const { Schema, model, models } = require("mongoose");
const { requiredDateField } = require("./dateFields");

const auditLogSchema = new Schema(
  {
    id: { type: Number, required: true, unique: true, index: true },
    action: { type: String, required: true, trim: true, index: true },
    entityType: { type: String, required: true, trim: true, index: true },
    entityId: { type: String, required: true, trim: true, index: true },
    actorUserId: { type: Number, default: null, index: true },
    actorStaffId: { type: String, required: true, default: "", trim: true },
    actorName: { type: String, required: true, default: "", trim: true },
    details: { type: Schema.Types.Mixed, required: true, default: {} },
    createdAt: requiredDateField({ index: true }),
  },
  {
    versionKey: false,
  }
);

auditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

module.exports = models.AuditLog || model("AuditLog", auditLogSchema);
