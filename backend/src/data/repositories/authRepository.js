const crypto = require("crypto");
const models = require("../models");

const COUNTER_KEYS = {
  userAccessEvent: "user_access_event_id",
};

function safeDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toIsoTimestamp(value, fallback = null) {
  const parsed = safeDate(value);
  if (parsed) {
    return parsed.toISOString();
  }

  if (fallback === null || fallback === undefined) {
    return new Date().toISOString();
  }

  const fallbackParsed = safeDate(fallback);
  return fallbackParsed ? fallbackParsed.toISOString() : new Date().toISOString();
}

function toNullableIsoTimestamp(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = safeDate(value);
  return parsed ? parsed.toISOString() : fallback;
}

function normalizeUser(row) {
  if (!row) return null;

  return {
    id: Number(row.id),
    staffId: String(row.staffId || "").trim(),
    pin: String(row.pinHash || ""),
    fullName: String(row.fullName || "").trim(),
    roleId: row.roleId === null || row.roleId === undefined ? null : Number(row.roleId),
    role: String(row.role || "").trim(),
    department: String(row.department || "").trim(),
    email: String(row.email || "").trim(),
    phone: String(row.phone || "").trim(),
    status: String(row.status || "Active").trim() || "Active",
    pinStatus:
      String(row.pinStatus || (String(row.pinHash || "").trim() ? "Assigned" : "Not Set")).trim() ||
      "Not Set",
    approvedBy: String(row.approvedBy || "").trim(),
    shiftAssignment: String(row.shiftAssignment || "Unassigned").trim() || "Unassigned",
    staffNotes: String(row.staffNotes || "").trim(),
    incidentFlag: String(row.incidentFlag || "Clear").trim() || "Clear",
    incidentNote: String(row.incidentNote || "").trim(),
    forcePinChange: Boolean(row.forcePinChange),
    isPinned: Boolean(row.isPinned),
    timetable: row.timetable && typeof row.timetable === "object" ? row.timetable : {},
    createdAt: toIsoTimestamp(row.createdAt, row.invitedAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
    invitedAt: toNullableIsoTimestamp(row.invitedAt),
    approvedAt: toNullableIsoTimestamp(row.approvedAt),
    pinUpdatedAt: toNullableIsoTimestamp(row.pinUpdatedAt),
  };
}

function normalizeSession(row) {
  if (!row) return null;

  return {
    id: String(row.id || "").trim(),
    userId: Number(row.userId || 0),
    staffId: String(row.staffId || "").trim(),
    fullName: String(row.fullName || "").trim(),
    status: String(row.status || "Active").trim() || "Active",
    loginAt: toIsoTimestamp(row.loginAt),
    lastSeenAt: toIsoTimestamp(row.lastSeenAt, row.loginAt),
    logoutAt: toNullableIsoTimestamp(row.logoutAt),
    loginReason: String(row.loginReason || "").trim(),
    logoutReason: String(row.logoutReason || "").trim(),
  };
}

function buildExactCaseInsensitiveRegex(value) {
  const escaped = String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`, "i");
}

async function nextSequence(key) {
  const now = new Date();
  const counter = await models.Counter.findOneAndUpdate(
    { key },
    {
      $inc: { seq: 1 },
      $set: { updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    {
      upsert: true,
      new: true,
    }
  ).lean();

  return Number(counter?.seq || 1);
}

async function logUserAccessEvent(entry = {}) {
  const id = await nextSequence(COUNTER_KEYS.userAccessEvent);
  await models.UserAccessEvent.create({
    id,
    userId: entry.userId === null || entry.userId === undefined ? null : Number(entry.userId),
    staffId: String(entry.staffId || "").trim(),
    fullName: String(entry.fullName || "").trim(),
    eventType: String(entry.eventType || "").trim(),
    title: String(entry.title || "").trim(),
    message: String(entry.message || "").trim(),
    actorName: String(entry.actorName || "").trim(),
    createdAt: safeDate(entry.createdAt) || new Date(),
  });

  return id;
}

async function getUserById(id) {
  const user = await models.User.findOne({ id: Number(id) }).lean();
  return normalizeUser(user);
}

async function getUserByStaffId(staffId) {
  const normalized = String(staffId || "").trim();
  if (!normalized) return null;

  const user = await models.User.findOne({
    staffId: buildExactCaseInsensitiveRegex(normalized),
  }).lean();

  return normalizeUser(user);
}

async function getActiveUsers() {
  const users = await models.User.find({ status: "Active" }).sort({ id: 1 }).lean();
  return users.map(normalizeUser);
}

async function createUserSession(user, options = {}) {
  if (!user?.id) return null;

  const sessionId = String(options.sessionId || crypto.randomUUID()).trim();
  const loginAt = safeDate(options.loginAt) || new Date();
  const loginReason = String(options.loginReason || "Interactive login").trim();

  await models.UserSession.create({
    id: sessionId,
    userId: Number(user.id),
    staffId: String(user.staffId || "").trim(),
    fullName: String(user.fullName || "").trim(),
    status: "Active",
    loginAt,
    lastSeenAt: loginAt,
    logoutAt: null,
    loginReason,
    logoutReason: "",
  });

  await logUserAccessEvent({
    userId: user.id,
    staffId: user.staffId,
    fullName: user.fullName,
    eventType: "login_success",
    title: "Signed in",
    message: "The staff member signed into the workspace successfully.",
    actorName: String(user.fullName || user.staffId || "Staff").trim(),
    createdAt: loginAt,
  });

  return getUserSessionById(sessionId);
}

async function getUserSessionById(sessionId) {
  const normalizedId = String(sessionId || "").trim();
  if (!normalizedId) return null;

  const session = await models.UserSession.findOne({ id: normalizedId }).lean();
  return normalizeSession(session);
}

async function touchUserSession(sessionId, touchedAt = new Date().toISOString()) {
  const normalizedId = String(sessionId || "").trim();
  if (!normalizedId) return null;

  await models.UserSession.updateOne(
    { id: normalizedId, status: "Active" },
    {
      $set: {
        lastSeenAt: safeDate(touchedAt) || new Date(),
      },
    }
  );

  return getUserSessionById(normalizedId);
}

async function closeUserSession(sessionId, options = {}) {
  const normalizedId = String(sessionId || "").trim();
  if (!normalizedId) return null;

  const existing = await getUserSessionById(normalizedId);
  if (!existing) return null;
  if (String(existing.status || "").trim() !== "Active") {
    return existing;
  }

  const logoutAt = safeDate(options.logoutAt) || new Date();
  const logoutReason = String(options.logoutReason || "Manual logout").trim();

  await models.UserSession.updateOne(
    { id: normalizedId },
    {
      $set: {
        status: "Closed",
        logoutAt,
        lastSeenAt: logoutAt,
        logoutReason,
      },
    }
  );

  await logUserAccessEvent({
    userId: existing.userId,
    staffId: existing.staffId,
    fullName: existing.fullName,
    eventType: "logout",
    title: "Signed out",
    message: "The staff member ended the workspace session.",
    actorName: String(existing.fullName || existing.staffId || "Staff").trim(),
    createdAt: logoutAt,
  });

  return getUserSessionById(normalizedId);
}

async function recordUserLoginFailure(staffId, reason = "Invalid Staff ID or PIN.") {
  const normalizedStaffId = String(staffId || "").trim().toUpperCase();
  const existing = normalizedStaffId ? await getUserByStaffId(normalizedStaffId) : null;

  await logUserAccessEvent({
    userId: existing?.id ?? null,
    staffId: existing?.staffId || normalizedStaffId,
    fullName: existing?.fullName || "",
    eventType: "login_failed",
    title: "Login failed",
    message: String(reason || "Invalid Staff ID or PIN.").trim(),
    actorName: "Auth",
    createdAt: new Date(),
  });

  return null;
}

async function countRecentLoginFailuresForStaffId(staffId, windowMinutes = 15) {
  const normalizedStaffId = String(staffId || "").trim();
  if (!normalizedStaffId) return 0;

  const cutoff = new Date(Date.now() - Number(windowMinutes || 15) * 60 * 1000);
  return models.UserAccessEvent.countDocuments({
    eventType: "login_failed",
    staffId: buildExactCaseInsensitiveRegex(normalizedStaffId),
    createdAt: { $gte: cutoff },
  });
}

async function changeOwnUserPin(id, pinHash) {
  const existing = await getUserById(id);
  if (!existing) return null;

  const changedAt = new Date();
  await models.User.updateOne(
    { id: Number(id) },
    {
      $set: {
        pinHash: String(pinHash || ""),
        pinStatus: "Assigned",
        pinUpdatedAt: changedAt,
        forcePinChange: false,
        updatedAt: changedAt,
      },
    }
  );

  await logUserAccessEvent({
    userId: existing.id,
    staffId: existing.staffId,
    fullName: existing.fullName,
    eventType: "pin_changed_self",
    title: "PIN changed by staff",
    message: "The staff member changed the temporary PIN and cleared first-login reset.",
    actorName: existing.fullName,
    createdAt: changedAt,
  });

  return getUserById(id);
}

module.exports = {
  getUserById,
  getUserByStaffId,
  getActiveUsers,
  createUserSession,
  getUserSessionById,
  touchUserSession,
  closeUserSession,
  recordUserLoginFailure,
  countRecentLoginFailuresForStaffId,
  changeOwnUserPin,
};
