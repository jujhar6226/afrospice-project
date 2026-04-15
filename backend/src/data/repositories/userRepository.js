const models = require("../models");
const { getDefaultShiftForRole } = require("../../validation/userValidators");
const {
  applySessionToQuery,
  buildExactCaseInsensitiveRegex,
  cloneValue,
  compactLookupText,
  ensureCounterAtLeast,
  lookupKey,
  nextSequence,
  safeDate,
  toIsoTimestamp,
  toNullableIsoTimestamp,
  withOptionalTransaction,
} = require("./mongoRepositoryUtils");

const COUNTER_KEYS = {
  role: "role_id",
  user: "user_id",
  userAccessEvent: "user_access_event_id",
  userSavedView: "user_saved_view_id",
};

const TIMETABLE_DAY_KEYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const DEFAULT_TIMETABLE_WINDOWS = {
  Flexible: { start: "09:00", end: "17:00" },
  "Front Desk": { start: "09:00", end: "18:00" },
  Morning: { start: "08:00", end: "16:00" },
  Midday: { start: "10:00", end: "18:00" },
  Evening: { start: "12:00", end: "20:00" },
  Stockroom: { start: "07:00", end: "15:00" },
  Receiving: { start: "06:00", end: "14:00" },
  "On Call": { start: "09:00", end: "17:00" },
  Off: { start: "00:00", end: "00:00" },
  Unassigned: { start: "09:00", end: "17:00" },
};

function isValidTimeValue(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "").trim());
}

function buildDefaultTimetable(shiftAssignment = "Flexible") {
  const normalizedShift = String(shiftAssignment || "Flexible").trim() || "Flexible";
  const window =
    DEFAULT_TIMETABLE_WINDOWS[normalizedShift] || DEFAULT_TIMETABLE_WINDOWS.Flexible;
  const weekdayActive = normalizedShift !== "Off";

  return Object.fromEntries(
    TIMETABLE_DAY_KEYS.map((dayKey, index) => [
      dayKey,
      {
        active: weekdayActive && index < 5,
        shift: normalizedShift,
        start: window.start,
        end: window.end,
      },
    ])
  );
}

function normalizeStoredTimetable(raw, shiftAssignment = "Flexible") {
  const fallback = buildDefaultTimetable(shiftAssignment);
  let parsed = {};

  if (typeof raw === "string" && raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  } else if (raw && typeof raw === "object") {
    parsed = raw;
  }

  return Object.fromEntries(
    TIMETABLE_DAY_KEYS.map((dayKey) => {
      const source = parsed?.[dayKey] || {};
      const fallbackDay = fallback[dayKey];
      const nextShift = String(source.shift || fallbackDay.shift || "Flexible").trim() || "Flexible";

      return [
        dayKey,
        {
          active: Boolean(source.active ?? fallbackDay.active),
          shift: nextShift,
          start: isValidTimeValue(source.start) ? String(source.start) : fallbackDay.start,
          end: isValidTimeValue(source.end) ? String(source.end) : fallbackDay.end,
        },
      ];
    })
  );
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
    timetable: row.timetable && typeof row.timetable === "object" ? cloneValue(row.timetable) : {},
    createdAt: toIsoTimestamp(row.createdAt, row.invitedAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
    invitedAt: toNullableIsoTimestamp(row.invitedAt),
    approvedAt: toNullableIsoTimestamp(row.approvedAt),
    pinUpdatedAt: toNullableIsoTimestamp(row.pinUpdatedAt),
  };
}

function normalizeAccessEvent(row) {
  if (!row) return null;

  return {
    id: Number(row.id || 0),
    userId: row.userId === null || row.userId === undefined ? null : Number(row.userId),
    staffId: String(row.staffId || "").trim(),
    fullName: String(row.fullName || "").trim(),
    eventType: String(row.eventType || "").trim(),
    title: String(row.title || "").trim(),
    message: String(row.message || "").trim(),
    actorName: String(row.actorName || "").trim(),
    createdAt: toIsoTimestamp(row.createdAt),
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

function normalizeSavedView(row) {
  if (!row) return null;

  return {
    id: Number(row.id || 0),
    ownerUserId: Number(row.ownerUserId || 0),
    pageKey: String(row.pageKey || "").trim(),
    name: String(row.name || "").trim(),
    config: row.config && typeof row.config === "object" ? cloneValue(row.config) : {},
    createdAt: toIsoTimestamp(row.createdAt),
    updatedAt: toIsoTimestamp(row.updatedAt, row.createdAt),
  };
}

async function logUserAccessEvent(entry = {}, session = null) {
  const id = await nextSequence(COUNTER_KEYS.userAccessEvent, { session });
  await models.UserAccessEvent.create(
    [
      {
        id,
        userId: entry.userId === null || entry.userId === undefined ? null : Number(entry.userId),
        staffId: String(entry.staffId || "").trim(),
        fullName: String(entry.fullName || "").trim(),
        eventType: String(entry.eventType || "").trim(),
        title: String(entry.title || "").trim(),
        message: String(entry.message || "").trim(),
        actorName: String(entry.actorName || "").trim(),
        createdAt: safeDate(entry.createdAt) || new Date(),
      },
    ],
    session ? { session } : undefined
  );

  return id;
}

async function ensureRoleId(name, { session = null } = {}) {
  const normalized = compactLookupText(name);
  if (!normalized) return null;

  const existing = await applySessionToQuery(
    models.Role.findOne({
      name: buildExactCaseInsensitiveRegex(normalized),
    }).lean(),
    session
  );

  if (existing) {
    return Number(existing.id);
  }

  const now = new Date();
  const id = await nextSequence(COUNTER_KEYS.role, { session });
  await models.Role.create(
    [
      {
        id,
        code: lookupKey(normalized).replace(/[^a-z0-9]+/g, "_") || `role_${id}`,
        name: normalized,
        description: "Runtime-created role.",
        createdAt: now,
        updatedAt: now,
      },
    ],
    { session }
  );

  return id;
}

async function loadUserDocument(id, session = null) {
  return applySessionToQuery(
    models.User.findOne({ id: Number(id) }).lean(),
    session
  );
}

async function getUsers() {
  const rows = await models.User.find({}).sort({ id: 1 }).lean();
  return rows.map(normalizeUser);
}

async function getUserById(id) {
  const row = await loadUserDocument(id);
  return normalizeUser(row);
}

async function getUserByStaffId(staffId) {
  const normalized = String(staffId || "").trim();
  if (!normalized) return null;

  const row = await models.User.findOne({
    staffId: buildExactCaseInsensitiveRegex(normalized),
  }).lean();

  return normalizeUser(row);
}

async function getUserAccessEvents(userId, limit = 20) {
  const normalizedLimit = Number(limit);
  const rows = await models.UserAccessEvent.find({ userId: Number(userId) })
    .sort({ createdAt: -1, id: -1 })
    .limit(Number.isFinite(normalizedLimit) && normalizedLimit > 0 ? normalizedLimit : 20)
    .lean();

  return rows.map(normalizeAccessEvent);
}

async function getAllUserAccessEvents(limit = null) {
  const normalizedLimit = Number(limit);
  let query = models.UserAccessEvent.find({}).sort({ createdAt: -1, id: -1 });
  if (Number.isFinite(normalizedLimit) && normalizedLimit > 0) {
    query = query.limit(normalizedLimit);
  }

  const rows = await query.lean();
  return rows.map(normalizeAccessEvent);
}

async function getUserSessions(userId, limit = 12) {
  const normalizedLimit = Number(limit);
  const rows = await models.UserSession.find({ userId: Number(userId) })
    .sort({ loginAt: -1, id: -1 })
    .limit(Number.isFinite(normalizedLimit) && normalizedLimit > 0 ? normalizedLimit : 12)
    .lean();

  return rows.map(normalizeSession);
}

async function getUserSessionSummary(userId) {
  const sessions = await getUserSessions(userId, 8);
  const activeSessions = sessions.filter((session) => String(session.status || "").trim() === "Active");
  const lastLogin = sessions[0] || null;
  const lastLogout = sessions.find((session) => session.logoutAt) || null;
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const failedLoginEvents = await getUserAccessEvents(userId, 50);
  const failedLoginCount = failedLoginEvents.filter((event) => {
    if (String(event.eventType || "").trim() !== "login_failed") return false;
    const eventDate = safeDate(event.createdAt);
    return eventDate ? eventDate.getTime() >= weekAgo : false;
  }).length;

  return {
    activeSessionCount: activeSessions.length,
    lastLoginAt: lastLogin?.loginAt || null,
    lastSeenAt: activeSessions[0]?.lastSeenAt || lastLogin?.lastSeenAt || null,
    lastLogoutAt: lastLogout?.logoutAt || null,
    failedLoginCount7d: Number(failedLoginCount || 0),
    sessions,
  };
}

async function getUserOversight(userId) {
  const [summary, events, sessions] = await Promise.all([
    getUserSessionSummary(userId),
    getUserAccessEvents(userId, 20),
    getUserSessions(userId, 8),
  ]);

  return {
    summary,
    events,
    sessions,
  };
}

async function getNextUserId() {
  const row = await models.User.findOne({}).sort({ id: -1 }).select({ id: 1 }).lean();
  return Number(row?.id || 0) + 1;
}

async function createUser(user, actorName = "") {
  const invitedAt = safeDate(user.invitedAt) || new Date();
  const createdAt = safeDate(user.createdAt) || invitedAt;
  const normalizedStatus = String(user.status || "Active").trim() || "Active";
  const approvedAt = normalizedStatus === "Active" ? safeDate(user.approvedAt) || invitedAt : null;
  const approvedBy = normalizedStatus === "Active" ? String(user.approvedBy || "").trim() : "";
  const pinUpdatedAt = String(user.pin || "").trim()
    ? safeDate(user.pinUpdatedAt) || approvedAt || invitedAt
    : null;
  const shiftAssignment =
    String(user.shiftAssignment || "").trim() || getDefaultShiftForRole(user.role);
  const roleName = compactLookupText(user.role);
  const roleId = await ensureRoleId(roleName);
  const timetable = normalizeStoredTimetable(user.timetable, shiftAssignment);
  const hasExplicitId = user.id !== null && user.id !== undefined;
  const id = hasExplicitId ? Number(user.id) : await nextSequence(COUNTER_KEYS.user);

  await models.User.create({
    id,
    staffId: String(user.staffId || "").trim(),
    pinHash: String(user.pin || ""),
    fullName: String(user.fullName || "").trim(),
    role: roleName,
    roleId,
    department: String(user.department || "").trim(),
    email: String(user.email || "").trim(),
    phone: String(user.phone || "").trim(),
    status: normalizedStatus,
    pinStatus:
      String(user.pinStatus || "").trim() || (String(user.pin || "").trim() ? "Assigned" : "Not Set"),
    invitedAt,
    approvedAt,
    approvedBy,
    pinUpdatedAt,
    shiftAssignment,
    staffNotes: String(user.staffNotes || "").trim(),
    incidentFlag: String(user.incidentFlag || "Clear").trim() || "Clear",
    incidentNote: String(user.incidentNote || "").trim(),
    forcePinChange: Boolean(user.forcePinChange),
    isPinned: Boolean(user.isPinned),
    timetable,
    createdAt,
    updatedAt: safeDate(user.updatedAt) || createdAt,
  });

  if (hasExplicitId) {
    await ensureCounterAtLeast(COUNTER_KEYS.user, id);
  }

  await logUserAccessEvent({
    userId: id,
    staffId: user.staffId,
    fullName: user.fullName,
    eventType: "record_created",
    title: "Staff record created",
    message: "The staff account was added to the roster and is waiting for access setup.",
    actorName: String(actorName || approvedBy || "Roster Admin").trim(),
    createdAt: invitedAt,
  });

  return getUserById(id);
}

async function updateUser(id, user, actorName = "") {
  const existing = await getUserById(id);
  if (!existing) return null;

  const shiftAssignment =
    String(user.shiftAssignment || "").trim() || getDefaultShiftForRole(user.role);
  const timetable = normalizeStoredTimetable(user.timetable ?? existing.timetable, shiftAssignment);
  const roleName = compactLookupText(user.role);
  const roleId = await ensureRoleId(roleName);
  const updatedAt = new Date();

  await models.User.updateOne(
    { id: Number(id) },
    {
      $set: {
        staffId: String(user.staffId || "").trim(),
        fullName: String(user.fullName || "").trim(),
        role: roleName,
        roleId,
        department: String(user.department || "").trim(),
        email: String(user.email || "").trim(),
        phone: String(user.phone || "").trim(),
        status: String(user.status || "Active").trim() || "Active",
        shiftAssignment,
        staffNotes: String(user.staffNotes || "").trim(),
        incidentFlag: String(user.incidentFlag || "Clear").trim() || "Clear",
        incidentNote: String(user.incidentNote || "").trim(),
        forcePinChange: Boolean(user.forcePinChange),
        isPinned: Boolean(user.isPinned),
        timetable,
        updatedAt,
      },
    }
  );

  await logUserAccessEvent({
    userId: existing.id,
    staffId: user.staffId,
    fullName: user.fullName,
    eventType: "profile_updated",
    title: "Profile updated",
    message: "Staff role, department, or contact details were updated.",
    actorName: String(actorName || "Roster Admin").trim(),
    createdAt: updatedAt,
  });

  return getUserById(id);
}

async function assignUserPin(id, pinHash, actorName = "") {
  const existing = await getUserById(id);
  if (!existing) return null;

  const pinUpdatedAt = new Date();
  await models.User.updateOne(
    { id: Number(id) },
    {
      $set: {
        pinHash: String(pinHash || ""),
        pinStatus: "Assigned",
        pinUpdatedAt,
        forcePinChange: true,
        updatedAt: pinUpdatedAt,
      },
    }
  );

  await logUserAccessEvent({
    userId: existing.id,
    staffId: existing.staffId,
    fullName: existing.fullName,
    eventType: existing.pinStatus === "Assigned" ? "pin_reset" : "pin_assigned",
    title: existing.pinStatus === "Assigned" ? "PIN reset" : "PIN assigned",
    message:
      existing.pinStatus === "Assigned"
        ? "The sign-in PIN was reset for this account and must be changed on next login."
        : "A sign-in PIN was issued for this account and must be changed on first login.",
    actorName: String(actorName || "Owner").trim(),
    createdAt: pinUpdatedAt,
  });

  return getUserById(id);
}

async function approveUserAccess(id, actorName = "") {
  const existing = await getUserById(id);
  if (!existing) return null;

  const approvedAt = new Date();
  await models.User.updateOne(
    { id: Number(id) },
    {
      $set: {
        status: "Active",
        approvedAt,
        approvedBy: String(actorName || "").trim(),
        updatedAt: approvedAt,
      },
    }
  );

  await logUserAccessEvent({
    userId: existing.id,
    staffId: existing.staffId,
    fullName: existing.fullName,
    eventType: "access_approved",
    title: "Access approved",
    message: "The account was approved for live sign-in access.",
    actorName,
    createdAt: approvedAt,
  });

  return getUserById(id);
}

async function updateUserAccessStatus(id, status, actorName = "") {
  const existing = await getUserById(id);
  if (!existing) return null;
  const normalizedStatus = String(status || "").trim();
  const updatedAt = new Date();

  await models.User.updateOne(
    { id: Number(id) },
    {
      $set: {
        status: normalizedStatus,
        updatedAt,
      },
    }
  );

  await logUserAccessEvent({
    userId: existing.id,
    staffId: existing.staffId,
    fullName: existing.fullName,
    eventType: normalizedStatus === "Active" ? "access_activated" : "access_deactivated",
    title: normalizedStatus === "Active" ? "Access activated" : "Access deactivated",
    message:
      normalizedStatus === "Active"
        ? "The account was set back to active sign-in status."
        : "The account was turned off and can no longer sign in.",
    actorName: String(actorName || "Owner").trim(),
    createdAt: updatedAt,
  });

  return getUserById(id);
}

async function deleteUser(id) {
  return withOptionalTransaction(async ({ session }) => {
    const existingRow = await loadUserDocument(id, session);
    if (!existingRow) return null;

    const existing = normalizeUser(existingRow);
    const userId = Number(id);
    const updatedAt = new Date();

    await Promise.all([
      models.Sale.updateMany(
        { cashierUserId: userId },
        {
          $set: {
            cashierUserId: null,
            updatedAt,
          },
        },
        { session }
      ),
      models.AuditLog.updateMany(
        { actorUserId: userId },
        {
          $set: {
            actorUserId: null,
          },
        },
        { session }
      ),
      models.User.deleteOne({ id: userId }, { session }),
      models.UserSession.deleteMany({ userId }, { session }),
      models.UserAccessEvent.deleteMany({ userId }, { session }),
      models.UserSavedView.deleteMany({ ownerUserId: userId }, { session }),
    ]);

    return existing;
  });
}

async function updateUserWorkforceProfile(id, profile = {}, actorName = "") {
  const existing = await getUserById(id);
  if (!existing) return null;

  const nextShiftAssignment =
    String(profile.shiftAssignment ?? existing.shiftAssignment ?? "").trim() ||
    getDefaultShiftForRole(existing.role);
  const nextStaffNotes = String(profile.staffNotes ?? existing.staffNotes ?? "").trim();
  const nextIncidentFlag = String(profile.incidentFlag ?? existing.incidentFlag ?? "Clear").trim() || "Clear";
  const nextIncidentNote = String(profile.incidentNote ?? existing.incidentNote ?? "").trim();
  const nextIsPinned = Boolean(profile.isPinned ?? existing.isPinned);
  const nextTimetable = normalizeStoredTimetable(profile.timetable ?? existing.timetable, nextShiftAssignment);
  const updatedAt = new Date();

  await models.User.updateOne(
    { id: Number(id) },
    {
      $set: {
        shiftAssignment: nextShiftAssignment,
        staffNotes: nextStaffNotes,
        incidentFlag: nextIncidentFlag,
        incidentNote: nextIncidentNote,
        isPinned: nextIsPinned,
        timetable: nextTimetable,
        updatedAt,
      },
    }
  );

  await logUserAccessEvent({
    userId: existing.id,
    staffId: existing.staffId,
    fullName: existing.fullName,
    eventType: "workforce_profile_updated",
    title: "Workforce profile updated",
    message: "Shift assignment, staff notes, or incident flags were updated.",
    actorName: String(actorName || "Owner").trim(),
    createdAt: updatedAt,
  });

  return getUserById(id);
}

async function getUserSavedViews(ownerUserId, pageKey = "users") {
  const normalizedPageKey = String(pageKey || "users").trim() || "users";
  const rows = await models.UserSavedView.find({
    ownerUserId: Number(ownerUserId),
    pageKey: normalizedPageKey,
  })
    .sort({ updatedAt: -1, name: 1 })
    .lean();

  return rows.map(normalizeSavedView);
}

async function saveUserSavedView(ownerUserId, pageKey = "users", name = "", config = {}) {
  const normalizedName = String(name || "").replace(/\s+/g, " ").trim();
  const normalizedPageKey = String(pageKey || "users").replace(/\s+/g, " ").trim() || "users";
  const now = new Date();

  const existing = await models.UserSavedView.findOne({
    ownerUserId: Number(ownerUserId),
    pageKey: normalizedPageKey,
    name: normalizedName,
  }).lean();

  if (existing) {
    await models.UserSavedView.updateOne(
      { id: Number(existing.id) },
      {
        $set: {
          config: config && typeof config === "object" ? cloneValue(config) : {},
          updatedAt: now,
        },
      }
    );

    const updated = await models.UserSavedView.findOne({ id: Number(existing.id) }).lean();
    return normalizeSavedView(updated);
  }

  const id = await nextSequence(COUNTER_KEYS.userSavedView);
  await models.UserSavedView.create({
    id,
    ownerUserId: Number(ownerUserId),
    pageKey: normalizedPageKey,
    name: normalizedName,
    config: config && typeof config === "object" ? cloneValue(config) : {},
    createdAt: now,
    updatedAt: now,
  });

  const created = await models.UserSavedView.findOne({ id }).lean();
  return normalizeSavedView(created);
}

async function deleteUserSavedView(id, ownerUserId) {
  const existing = await models.UserSavedView.findOne({
    id: Number(id),
    ownerUserId: Number(ownerUserId),
  }).lean();

  if (!existing) return null;

  await models.UserSavedView.deleteOne({
    id: Number(id),
    ownerUserId: Number(ownerUserId),
  });

  return normalizeSavedView(existing);
}

module.exports = {
  assignUserPin,
  approveUserAccess,
  createUser,
  deleteUser,
  deleteUserSavedView,
  getAllUserAccessEvents,
  getNextUserId,
  getUserAccessEvents,
  getUserById,
  getUserByStaffId,
  getUserOversight,
  getUserSavedViews,
  getUsers,
  saveUserSavedView,
  updateUser,
  updateUserAccessStatus,
  updateUserWorkforceProfile,
};
