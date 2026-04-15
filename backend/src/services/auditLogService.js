const auditLogRepository = require("../data/repositories/auditLogRepository");

async function recordAuditEvent({
  actor = null,
  action,
  entityType,
  entityId,
  details = {},
}) {
  return auditLogRepository.insertAuditLog({
    action,
    entityType,
    entityId,
    actorUserId: actor?.id ?? null,
    actorStaffId: actor?.staffId || "",
    actorName: actor?.fullName || actor?.staffId || "System",
    details,
    createdAt: new Date().toISOString(),
  });
}

module.exports = {
  recordAuditEvent,
};
