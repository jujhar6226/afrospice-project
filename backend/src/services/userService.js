const bcrypt = require("bcryptjs");
const AppError = require("../errors/AppError");
const userRepository = require("../data/repositories/userRepository");
const {
  normalizeRole,
  getDefaultShiftForRole,
  validateUserPayload,
  validateWorkforceProfilePayload,
  validatePinAssignmentPayload,
  validateUserStatusPayload,
  validateSavedUserViewsQuery,
  validateSavedUserViewPayload,
} = require("../validation/userValidators");

function sanitizeUser(user) {
  if (!user) return null;
  const { pin, ...safeUser } = user;
  return safeUser;
}

function buildActorName(actor, fallback = "Roster Admin") {
  return String(actor?.fullName || actor?.staffId || fallback).trim();
}

function csvEscape(value) {
  const normalized = String(value ?? "");
  return `"${normalized.replace(/"/g, '""')}"`;
}

async function getRequiredUser(id) {
  const existing = await userRepository.getUserById(id);

  if (!existing) {
    throw new AppError(404, "User not found.", {
      code: "USER_NOT_FOUND",
    });
  }

  return existing;
}

async function buildNextStaffId(role) {
  const users = await userRepository.getUsers();

  if (role === "Owner") {
    const maxOwnerId = users
      .map((user) => String(user.staffId || "").trim())
      .map((staffId) => /^ADMIN(\d{3,})$/.exec(staffId))
      .filter(Boolean)
      .reduce((max, match) => Math.max(max, Number(match[1] || 0)), 0);

    return `ADMIN${String(maxOwnerId + 1).padStart(3, "0")}`;
  }

  const maxAfrId = users
    .map((user) => String(user.staffId || "").trim())
    .map((staffId) => /^AFR-(\d{3,})$/.exec(staffId))
    .filter(Boolean)
    .reduce((max, match) => Math.max(max, Number(match[1] || 0)), 0);

  return `AFR-${String(maxAfrId + 1).padStart(3, "0")}`;
}

async function getUsers() {
  const users = await userRepository.getUsers();
  const hydratedUsers = await Promise.all(
    users.map(async (user) => ({
      ...sanitizeUser(user),
      oversight: (await userRepository.getUserOversight(user.id)).summary,
    }))
  );

  return hydratedUsers;
}

async function getUserById(id) {
  const existing = await getRequiredUser(id);
  const oversight = await userRepository.getUserOversight(existing.id);

  return {
    ...sanitizeUser(existing),
    oversight: oversight.summary,
  };
}

async function getUserAccessEvents(id) {
  const existing = await getRequiredUser(id);
  return userRepository.getUserAccessEvents(existing.id);
}

async function getUserOversight(id) {
  const existing = await getRequiredUser(id);
  return userRepository.getUserOversight(existing.id);
}

async function createUser(payload, actor) {
  const role = normalizeRole(payload?.role);

  if (!role) {
    throw new AppError(400, "A valid role is required.", {
      code: "VALIDATION_ERROR",
    });
  }

  const nextStaffId = await buildNextStaffId(role);
  const validated = validateUserPayload(payload, {
    nextStaffId,
  });
  const duplicate = await userRepository.getUserByStaffId(validated.staffId);

  if (duplicate) {
    throw new AppError(409, "A user with this staff ID already exists.", {
      code: "USER_STAFF_ID_CONFLICT",
    });
  }

  const invitedAt = new Date().toISOString();
  const createdUser = await userRepository.createUser(
    {
      id: await userRepository.getNextUserId(),
      staffId: validated.staffId,
      pin: "",
      fullName: validated.fullName,
      role: validated.role,
      department: validated.department,
      email: validated.email,
      phone: validated.phone,
      status: "Pending Approval",
      pinStatus: "Not Set",
      shiftAssignment:
        validated.shiftAssignment || getDefaultShiftForRole(validated.role),
      staffNotes: validated.staffNotes || "",
      incidentFlag: validated.incidentFlag || "Clear",
      incidentNote: validated.incidentNote || "",
      forcePinChange: false,
      isPinned: false,
      timetable: validated.timetable,
      invitedAt,
      approvedAt: null,
      approvedBy: "",
      pinUpdatedAt: null,
    },
    buildActorName(actor)
  );

  return sanitizeUser(createdUser);
}

async function updateUser(id, payload, actor) {
  const existing = await getRequiredUser(id);
  const role = normalizeRole(payload?.role ?? existing?.role);

  if (!role) {
    throw new AppError(400, "A valid role is required.", {
      code: "VALIDATION_ERROR",
    });
  }

  const validated = validateUserPayload(payload, {
    existing,
    nextStaffId: existing.staffId,
  });
  const duplicate = await userRepository.getUserByStaffId(validated.staffId);

  if (duplicate && String(duplicate.id) !== String(existing.id)) {
    throw new AppError(409, "A user with this staff ID already exists.", {
      code: "USER_STAFF_ID_CONFLICT",
    });
  }

  const updatedUser = await userRepository.updateUser(
    existing.id,
    {
      ...existing,
      staffId: validated.staffId,
      fullName: validated.fullName,
      role: validated.role,
      department: validated.department,
      email: validated.email,
      phone: validated.phone,
      status: existing.status,
      pin: existing.pin,
      shiftAssignment: validated.shiftAssignment,
      staffNotes: validated.staffNotes,
      incidentFlag: validated.incidentFlag,
      incidentNote: validated.incidentNote,
      forcePinChange: existing.forcePinChange,
      isPinned: validated.isPinned,
      timetable: validated.timetable,
    },
    buildActorName(actor)
  );

  return sanitizeUser(updatedUser);
}

async function assignUserPin(id, payload, actor) {
  const existing = await getRequiredUser(id);
  const validated = validatePinAssignmentPayload(payload);
  const hashedPin = await bcrypt.hash(validated.pin, 10);
  const updatedUser = await userRepository.assignUserPin(
    existing.id,
    hashedPin,
    buildActorName(actor, "Owner")
  );

  return {
    user: sanitizeUser(updatedUser),
    wasReset: String(existing.pinStatus) === "Assigned",
  };
}

async function approveUser(id, actor) {
  const existing = await getRequiredUser(id);

  if (String(existing.pinStatus) !== "Assigned" || !String(existing.pin || "").trim()) {
    throw new AppError(400, "Assign a PIN before approving access.", {
      code: "PIN_REQUIRED_FOR_APPROVAL",
    });
  }

  const approvedUser = await userRepository.approveUserAccess(
    existing.id,
    buildActorName(actor, "Owner")
  );

  return sanitizeUser(approvedUser);
}

async function updateUserStatus(id, payload, actor) {
  const existing = await getRequiredUser(id);
  const { status } = validateUserStatusPayload(payload);

  if (String(actor?.id) === String(existing.id) && status !== "Active") {
    throw new AppError(400, "You cannot deactivate your own account.", {
      code: "SELF_STATUS_CHANGE_NOT_ALLOWED",
    });
  }

  if (status === "Active") {
    if (String(existing.pinStatus) !== "Assigned" || !String(existing.pin || "").trim()) {
      throw new AppError(400, "Assign a PIN before activating access.", {
        code: "PIN_REQUIRED_FOR_ACTIVATION",
      });
    }

    const activated = await userRepository.approveUserAccess(
      existing.id,
      buildActorName(actor, "Owner")
    );

    return sanitizeUser(activated);
  }

  const updatedUser = await userRepository.updateUserAccessStatus(
    existing.id,
    status,
    buildActorName(actor, "Owner")
  );

  return sanitizeUser(updatedUser);
}

async function deleteUser(id, actor) {
  const target = await getRequiredUser(id);

  if (String(actor?.id) === String(target.id)) {
    throw new AppError(400, "You cannot delete your own account.", {
      code: "SELF_DELETE_NOT_ALLOWED",
    });
  }

  const deleted = await userRepository.deleteUser(id);
  return sanitizeUser(deleted);
}

async function updateUserWorkforceProfile(id, payload, actor) {
  const existing = await getRequiredUser(id);
  const validated = validateWorkforceProfilePayload(payload, existing);
  const updatedUser = await userRepository.updateUserWorkforceProfile(
    existing.id,
    validated,
    buildActorName(actor, "Owner")
  );

  return sanitizeUser(updatedUser);
}

async function exportUserAuditCsv() {
  const events = await userRepository.getAllUserAccessEvents(1000);
  const header = [
    "Created At",
    "Staff ID",
    "Full Name",
    "Event Type",
    "Title",
    "Message",
    "Actor",
  ];
  const rows = events.map((event) => [
    event.createdAt,
    event.staffId,
    event.fullName,
    event.eventType,
    event.title,
    event.message,
    event.actorName,
  ]);

  return {
    filename: `afrospice-user-audit-${new Date().toISOString().slice(0, 10)}.csv`,
    body: `\uFEFF${[header, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n")}`,
  };
}

async function exportSingleUserAuditCsv(id) {
  const existing = await getRequiredUser(id);
  const oversight = await userRepository.getUserOversight(existing.id);
  const header = [
    "Record Type",
    "Created At",
    "Staff ID",
    "Full Name",
    "State",
    "Title",
    "Message",
    "Actor",
    "Login At",
    "Last Seen At",
    "Logout At",
  ];
  const eventRows = (oversight.events || []).map((event) => [
    "Access Event",
    event.createdAt,
    event.staffId,
    event.fullName,
    event.eventType,
    event.title,
    event.message,
    event.actorName,
    "",
    "",
    "",
  ]);
  const sessionRows = (oversight.sessions || []).map((session) => [
    "Session",
    session.loginAt,
    session.staffId,
    session.fullName,
    session.status,
    session.logoutAt ? "Closed session" : "Active session",
    session.logoutReason || session.loginReason || "Tracked staff session lifecycle.",
    "",
    session.loginAt,
    session.lastSeenAt,
    session.logoutAt || "",
  ]);

  return {
    filename: `afrospice-user-audit-${String(existing.staffId || "staff").toLowerCase()}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`,
    body: `\uFEFF${[header, ...eventRows, ...sessionRows]
      .map((row) => row.map(csvEscape).join(","))
      .join("\n")}`,
  };
}

async function getSavedUserViews(actor, query) {
  const { pageKey } = validateSavedUserViewsQuery(query);
  const ownerUserId = Number(actor?.id || 0);
  return userRepository.getUserSavedViews(ownerUserId, pageKey);
}

async function saveUserView(actor, payload) {
  const ownerUserId = Number(actor?.id || 0);
  const { pageKey, name, config } = validateSavedUserViewPayload(payload);
  return userRepository.saveUserSavedView(ownerUserId, pageKey, name, config);
}

async function deleteSavedUserView(actor, viewId) {
  const ownerUserId = Number(actor?.id || 0);
  const deleted = await userRepository.deleteUserSavedView(viewId, ownerUserId);

  if (!deleted) {
    throw new AppError(404, "Saved view not found.", {
      code: "USER_VIEW_NOT_FOUND",
    });
  }

  return deleted;
}

module.exports = {
  getUsers,
  getUserById,
  getUserAccessEvents,
  getUserOversight,
  createUser,
  updateUser,
  assignUserPin,
  approveUser,
  updateUserStatus,
  deleteUser,
  updateUserWorkforceProfile,
  exportUserAuditCsv,
  exportSingleUserAuditCsv,
  getSavedUserViews,
  saveUserView,
  deleteSavedUserView,
};
