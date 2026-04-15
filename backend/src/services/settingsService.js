const settingsRepository = require("../data/repositories/settingsRepository");
const auditLogService = require("./auditLogService");
const { validateSettingsPatch } = require("../validation/settingsValidators");

async function getPublicSettings() {
  const settings = await settingsRepository.getAppSettings();

  return {
    storeName: settings.storeName,
    branchCode: settings.branchCode,
    supportEmail: settings.supportEmail,
    supportPhone: settings.supportPhone,
    currency: settings.currency,
    receiptFooter: settings.receiptFooter,
  };
}

async function getSettings() {
  return settingsRepository.getAppSettings();
}

async function updateSettings(payload, actor) {
  const patch = validateSettingsPatch(payload);
  const before = await settingsRepository.getAppSettings();
  const updated = await settingsRepository.updateAppSettings(patch);

  await auditLogService.recordAuditEvent({
    actor,
    action: "settings.updated",
    entityType: "settings",
    entityId: "app_settings:1",
    details: {
      changedFields: Object.keys(patch),
      before: Object.fromEntries(
        Object.keys(patch).map((key) => [key, before[key]])
      ),
      after: Object.fromEntries(
        Object.keys(patch).map((key) => [key, updated[key]])
      ),
    },
  });

  return updated;
}

module.exports = {
  getPublicSettings,
  getSettings,
  updateSettings,
};
