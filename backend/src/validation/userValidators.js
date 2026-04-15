const {
  ensureObject,
  compactText,
  throwValidationError,
} = require("./helpers");

const ACCESS_STATUSES = ["Pending Approval", "Active", "Inactive"];
const PIN_REGEX = /^\d{4,6}$/;
const SHIFT_OPTIONS = [
  "Flexible",
  "Front Desk",
  "Morning",
  "Midday",
  "Evening",
  "Stockroom",
  "Receiving",
  "On Call",
  "Off",
];
const INCIDENT_FLAGS = ["Clear", "Watch", "Incident", "Disciplinary"];
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
};
const ROLE_DEPARTMENTS = {
  Owner: ["Management"],
  Manager: ["Operations", "Management", "HMR"],
  Cashier: ["Sales", "Front Desk"],
  "Inventory Clerk": ["Inventory", "Operations"],
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeRole(role) {
  const value = compactText(role);
  const allowed = ["Owner", "Manager", "Cashier", "Inventory Clerk"];
  return allowed.includes(value) ? value : "";
}

function normalizeStatus(status) {
  const value = compactText(status || "Pending Approval");
  return ACCESS_STATUSES.includes(value) ? value : "Pending Approval";
}

function normalizeStaffId(staffId) {
  return compactText(staffId).toUpperCase();
}

function normalizeFullName(fullName) {
  return compactText(fullName);
}

function normalizeDepartment(department) {
  return compactText(department);
}

function normalizeEmail(email) {
  return compactText(email).toLowerCase();
}

function normalizePhone(phone) {
  return compactText(phone);
}

function normalizeShiftAssignment(shiftAssignment) {
  return compactText(shiftAssignment);
}

function normalizeStaffNotes(staffNotes) {
  return compactText(staffNotes);
}

function normalizeIncidentFlag(incidentFlag) {
  const value = compactText(incidentFlag || "Clear");
  return INCIDENT_FLAGS.includes(value) ? value : "Clear";
}

function normalizeIncidentNote(incidentNote) {
  return compactText(incidentNote);
}

function normalizeIsPinned(isPinned) {
  if (typeof isPinned === "boolean") return isPinned;
  if (typeof isPinned === "number") return isPinned === 1;

  const value = String(isPinned ?? "").trim().toLowerCase();
  if (!value) return false;
  return ["1", "true", "yes", "pinned", "on"].includes(value);
}

function isValidTimeValue(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || "").trim());
}

function getDefaultShiftForRole(role = "") {
  if (role === "Owner" || role === "Manager") return "Flexible";
  if (role === "Cashier") return "Front Desk";
  if (role === "Inventory Clerk") return "Stockroom";
  return "Unassigned";
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

function normalizeTimetable(timetable, fallbackShiftAssignment = "Flexible", existingTimetable = null) {
  const fallback =
    existingTimetable && typeof existingTimetable === "object"
      ? existingTimetable
      : buildDefaultTimetable(fallbackShiftAssignment);
  const source = timetable && typeof timetable === "object" ? timetable : {};

  return Object.fromEntries(
    TIMETABLE_DAY_KEYS.map((dayKey) => {
      const nextSource =
        source[dayKey] && typeof source[dayKey] === "object" ? source[dayKey] : {};
      const fallbackDay =
        fallback[dayKey] || buildDefaultTimetable(fallbackShiftAssignment)[dayKey];
      const nextShift = SHIFT_OPTIONS.includes(String(nextSource.shift || "").trim())
        ? String(nextSource.shift).trim()
        : String(fallbackDay.shift || fallbackShiftAssignment).trim() || fallbackShiftAssignment;

      return [
        dayKey,
        {
          active: Boolean(nextSource.active ?? fallbackDay.active),
          shift: nextShift,
          start: isValidTimeValue(nextSource.start)
            ? String(nextSource.start)
            : String(fallbackDay.start),
          end: isValidTimeValue(nextSource.end)
            ? String(nextSource.end)
            : String(fallbackDay.end),
        },
      ];
    })
  );
}

function isValidStaffId(staffId) {
  return /^(ADMIN\d{3}|AFR-\d{3})$/.test(staffId);
}

function isValidFullName(fullName) {
  const parts = String(fullName || "")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) return false;

  const cleanParts = parts.map((part) => part.replace(/['-]/g, ""));
  if (cleanParts.some((part) => !/^[A-Za-z]{2,30}$/.test(part))) {
    return false;
  }

  if (cleanParts.some((part) => !/[AEIOUaeiou]/.test(part))) {
    return false;
  }

  const totalLetters = cleanParts.reduce((sum, part) => sum + part.length, 0);
  return totalLetters >= 5;
}

function isValidDepartment(role, department) {
  const allowedDepartments = ROLE_DEPARTMENTS[role] || [];
  return allowedDepartments.includes(department);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPhone(phone, existingPhone = "") {
  const digits = String(phone || "").replace(/\D/g, "");
  const existingDigits = String(existingPhone || "").replace(/\D/g, "");

  if (digits === existingDigits && digits.length >= 7 && digits.length <= 15) {
    return true;
  }

  return digits.length >= 10 && digits.length <= 15;
}

function isValidShiftAssignment(shiftAssignment) {
  return SHIFT_OPTIONS.includes(shiftAssignment);
}

function formatFullName(fullName) {
  return normalizeFullName(fullName)
    .split(" ")
    .filter(Boolean)
    .map((part) =>
      part
        .split("-")
        .map((segment) =>
          segment
            .split("'")
            .map((piece) =>
              piece ? `${piece.charAt(0).toUpperCase()}${piece.slice(1).toLowerCase()}` : piece
            )
            .join("'")
        )
        .join("-")
    )
    .join(" ");
}

function validateUserPayload(payload = {}, options = {}) {
  const body = ensureObject(payload);
  const existing = options.existing || null;
  const nextStaffId = normalizeStaffId(options.nextStaffId || existing?.staffId);
  const nextRole = normalizeRole(body.role ?? existing?.role);
  const nextFullName = formatFullName(body.fullName ?? existing?.fullName);
  const nextDepartment = normalizeDepartment(body.department ?? existing?.department);
  const nextEmail = normalizeEmail(body.email ?? existing?.email);
  const nextPhone = normalizePhone(body.phone ?? existing?.phone);
  const nextStatus = normalizeStatus(existing?.status ?? "Pending Approval");
  const nextShiftAssignment = normalizeShiftAssignment(
    body.shiftAssignment ?? existing?.shiftAssignment ?? getDefaultShiftForRole(nextRole)
  );
  const nextStaffNotes = normalizeStaffNotes(body.staffNotes ?? existing?.staffNotes);
  const nextIncidentFlag = normalizeIncidentFlag(body.incidentFlag ?? existing?.incidentFlag);
  const nextIncidentNote = normalizeIncidentNote(body.incidentNote ?? existing?.incidentNote);
  const nextIsPinned = normalizeIsPinned(body.isPinned ?? existing?.isPinned);
  const nextTimetable = normalizeTimetable(
    body.timetable,
    nextShiftAssignment || getDefaultShiftForRole(nextRole),
    existing?.timetable
  );

  if (!nextRole) {
    throwValidationError("A valid role is required.");
  }

  if (!nextStaffId || !isValidStaffId(nextStaffId)) {
    throwValidationError("Staff ID must follow the managed business format.");
  }

  if (!nextFullName) {
    throwValidationError("Full name is required.");
  }

  if (!isValidFullName(nextFullName)) {
    throwValidationError(
      "Full name must use a real first and last name with letters and clear vowel structure."
    );
  }

  if (!nextDepartment) {
    throwValidationError("Department is required.");
  }

  if (!isValidDepartment(nextRole, nextDepartment)) {
    throwValidationError("Department must be chosen from the approved business roles list.");
  }

  if (!nextEmail) {
    throwValidationError("Email is required.");
  }

  if (!isValidEmail(nextEmail)) {
    throwValidationError("Enter a valid email address.");
  }

  if (!nextPhone) {
    throwValidationError("Phone is required.");
  }

  if (!isValidPhone(nextPhone, existing?.phone)) {
    throwValidationError("Enter a valid phone number using 10-15 digits.");
  }

  if (!nextShiftAssignment || !isValidShiftAssignment(nextShiftAssignment)) {
    throwValidationError("Shift assignment must use the approved business schedule list.");
  }

  if (nextStaffNotes.length > 280) {
    throwValidationError("Staff notes must stay within 280 characters.");
  }

  if (nextIncidentNote.length > 280) {
    throwValidationError("Incident notes must stay within 280 characters.");
  }

  return {
    staffId: nextStaffId,
    fullName: nextFullName,
    role: nextRole,
    department: nextDepartment,
    email: nextEmail,
    phone: nextPhone,
    status: nextStatus,
    shiftAssignment: nextShiftAssignment,
    staffNotes: nextStaffNotes,
    incidentFlag: nextIncidentFlag,
    incidentNote: nextIncidentNote,
    isPinned: nextIsPinned,
    timetable: nextTimetable,
  };
}

function validateWorkforceProfilePayload(payload = {}, existing = null) {
  const body = ensureObject(payload);
  const nextShiftAssignment = normalizeShiftAssignment(
    body.shiftAssignment ?? existing?.shiftAssignment
  );
  const nextStaffNotes = normalizeStaffNotes(body.staffNotes ?? existing?.staffNotes);
  const nextIncidentFlag = normalizeIncidentFlag(body.incidentFlag ?? existing?.incidentFlag);
  const nextIncidentNote = normalizeIncidentNote(body.incidentNote ?? existing?.incidentNote);
  const nextIsPinned = normalizeIsPinned(body.isPinned ?? existing?.isPinned);
  const nextTimetable = normalizeTimetable(
    body.timetable,
    nextShiftAssignment || existing?.shiftAssignment || "Flexible",
    existing?.timetable
  );

  if (!nextShiftAssignment || !isValidShiftAssignment(nextShiftAssignment)) {
    throwValidationError("Shift assignment must use the approved business schedule list.");
  }

  if (nextStaffNotes.length > 280) {
    throwValidationError("Staff notes must stay within 280 characters.");
  }

  if (nextIncidentNote.length > 280) {
    throwValidationError("Incident notes must stay within 280 characters.");
  }

  return {
    shiftAssignment: nextShiftAssignment,
    staffNotes: nextStaffNotes,
    incidentFlag: nextIncidentFlag,
    incidentNote: nextIncidentNote,
    isPinned: nextIsPinned,
    timetable: nextTimetable,
  };
}

function validatePinAssignmentPayload(payload = {}) {
  const body = ensureObject(payload);
  const pin = compactText(body.pin);

  if (!PIN_REGEX.test(pin)) {
    throwValidationError("PIN must be 4-6 digits.");
  }

  return {
    pin,
  };
}

function validateUserStatusPayload(payload = {}) {
  const body = ensureObject(payload);
  const nextStatus = normalizeStatus(body.status);

  if (!["Active", "Inactive"].includes(nextStatus)) {
    throwValidationError("A valid access status is required.");
  }

  return {
    status: nextStatus,
  };
}

function validateSavedUserViewsQuery(query = {}) {
  const pageKey = compactText(query?.page || "users") || "users";

  return {
    pageKey: pageKey.slice(0, 40),
  };
}

function validateSavedUserViewPayload(payload = {}) {
  const body = ensureObject(payload);
  const pageKey = compactText(body.pageKey || "users") || "users";
  const name = compactText(body.name);
  const config = isPlainObject(body.config) ? body.config : {};

  if (!name) {
    throwValidationError("A view name is required.");
  }

  if (name.length > 40) {
    throwValidationError("View names must stay within 40 characters.");
  }

  return {
    pageKey: pageKey.slice(0, 40),
    name,
    config,
  };
}

module.exports = {
  normalizeRole,
  getDefaultShiftForRole,
  validateUserPayload,
  validateWorkforceProfilePayload,
  validatePinAssignmentPayload,
  validateUserStatusPayload,
  validateSavedUserViewsQuery,
  validateSavedUserViewPayload,
};
