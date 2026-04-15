export const SHIFT_OPTIONS = [
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

export const INCIDENT_FLAGS = ["Clear", "Watch", "Incident", "Disciplinary"];
export const SESSION_FILTERS = ["All", "Active", "Closed"];
export const EVENT_FILTERS = ["All", "Security", "Access", "Profile"];
export const SAVED_VIEWS = ["All Staff", "Pending Access", "Live Sessions", "High Risk"];
export const TIMETABLE_DAYS = [
  { key: "monday", label: "Monday", short: "Mon" },
  { key: "tuesday", label: "Tuesday", short: "Tue" },
  { key: "wednesday", label: "Wednesday", short: "Wed" },
  { key: "thursday", label: "Thursday", short: "Thu" },
  { key: "friday", label: "Friday", short: "Fri" },
  { key: "saturday", label: "Saturday", short: "Sat" },
  { key: "sunday", label: "Sunday", short: "Sun" },
];

export const COLUMN_OPTIONS = [
  { key: "staffMember", label: "Staff Member" },
  { key: "staffId", label: "Staff ID" },
  { key: "role", label: "Role" },
  { key: "shift", label: "Shift" },
  { key: "access", label: "Access" },
  { key: "approval", label: "Approval" },
  { key: "pin", label: "PIN" },
  { key: "risk", label: "Risk" },
  { key: "lastSignIn", label: "Last Sign In" },
  { key: "lastSignOut", label: "Last Sign Out" },
  { key: "sessions", label: "Sessions" },
  { key: "failedSignIns", label: "Failed Sign-ins" },
  { key: "flag", label: "Flag" },
];

export const DEFAULT_COLUMN_VISIBILITY = {
  staffMember: true,
  staffId: true,
  role: true,
  shift: true,
  access: true,
  approval: true,
  pin: true,
  risk: true,
  lastSignIn: true,
  lastSignOut: true,
  sessions: true,
  failedSignIns: true,
  flag: true,
};

export const ROLE_DEPARTMENTS = {
  Owner: ["Management"],
  Manager: ["Operations", "Management", "HMR"],
  Cashier: ["Sales", "Front Desk"],
  "Inventory Clerk": ["Inventory", "Operations"],
};

export const emptyForm = {
  fullName: "",
  role: "Cashier",
  department: "Sales",
  email: "",
  phone: "",
  shiftAssignment: "Front Desk",
};

export function normalizeUsersResponse(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.users)) return payload.users;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.users)) return payload.data.users;
  return [];
}

export function normalizeSingleUserResponse(payload) {
  if (payload?.id) return payload;
  if (payload?.data?.id) return payload.data;
  if (payload?.user?.id) return payload.user;
  if (payload?.data?.user?.id) return payload.data.user;
  return null;
}

export function normalizeOversightResponse(payload) {
  if (payload?.summary || payload?.events || payload?.sessions) return payload;
  if (payload?.data?.summary || payload?.data?.events || payload?.data?.sessions) return payload.data;
  return { summary: {}, events: [], sessions: [] };
}

export function formatAuditTime(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString();
}

export function formatRelativeTime(value) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  const diffMs = Date.now() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes <= 0) return "Just now";
  if (diffMinutes === 1) return "1 min ago";
  if (diffMinutes < 60) return `${diffMinutes} mins ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours === 1) return "1 hr ago";
  if (diffHours < 24) return `${diffHours} hrs ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "1 day ago";
  return `${diffDays} days ago`;
}

export function formatPersonName(value = "") {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
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

export function getDefaultShiftForRole(role = "") {
  if (role === "Owner" || role === "Manager") return "Flexible";
  if (role === "Cashier") return "Front Desk";
  if (role === "Inventory Clerk") return "Stockroom";
  return "Flexible";
}

export function getNextManagedStaffId(users, role) {
  if (role === "Owner") {
    const maxOwnerId = users
      .map((user) => /^ADMIN(\d{3,})$/.exec(String(user.staffId || "")))
      .filter(Boolean)
      .reduce((max, match) => Math.max(max, Number(match[1] || 0)), 0);

    return `ADMIN${String(maxOwnerId + 1).padStart(3, "0")}`;
  }

  const maxAfrId = users
    .map((user) => /^AFR-(\d{3,})$/.exec(String(user.staffId || "")))
    .filter(Boolean)
    .reduce((max, match) => Math.max(max, Number(match[1] || 0)), 0);

  return `AFR-${String(maxAfrId + 1).padStart(3, "0")}`;
}

export function getStatusTone(status = "") {
  if (status === "Active") return "success";
  if (status === "Pending Approval") return "warning";
  return "danger";
}

export function getPinTone(status = "") {
  return status === "Assigned" ? "success" : "warning";
}

export function getIncidentTone(flag = "") {
  if (flag === "Clear") return "success";
  if (flag === "Watch") return "warning";
  return "danger";
}

export function getPresence(user) {
  const sessions = Number(user?.oversight?.activeSessionCount || 0);
  const lastSeenAt = user?.oversight?.lastSeenAt || "";
  if (sessions > 0) return "Live";
  if (lastSeenAt) return "Recently seen";
  return "Quiet";
}

function getDaysSince(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
}

export function getOverdueActivity(user = {}) {
  const approvalAgeDays = getDaysSince(user?.invitedAt);
  const inactivityDays = getDaysSince(user?.oversight?.lastSeenAt || user?.oversight?.lastLoginAt);

  if (String(user.status || "") === "Pending Approval" && approvalAgeDays !== null && approvalAgeDays >= 3) {
    return {
      isOverdue: true,
      label: `${approvalAgeDays}d pending`,
      reason: "Pending approval has been sitting without owner action.",
      tone: "warning",
    };
  }

  if (String(user.status || "") === "Active" && inactivityDays !== null && inactivityDays >= 7) {
    return {
      isOverdue: true,
      label: `${inactivityDays}d idle`,
      reason: "Active staff account has no recent sign-in activity.",
      tone: "danger",
    };
  }

  return {
    isOverdue: false,
    label: "Current",
    reason: "No overdue access or sign-in activity.",
    tone: "success",
  };
}

export function getRiskScore(user = {}) {
  const failedLoginCount = Number(user?.oversight?.failedLoginCount7d || 0);
  const activeSessions = Number(user?.oversight?.activeSessionCount || 0);
  const overdue = getOverdueActivity(user);

  let score = 0;

  if (String(user.status || "") === "Pending Approval") score += 28;
  if (String(user.status || "") === "Inactive") score += 12;
  if (String(user.pinStatus || "") !== "Assigned") score += 22;
  if (user.forcePinChange) score += 8;

  switch (String(user.incidentFlag || "Clear")) {
    case "Watch":
      score += 15;
      break;
    case "Incident":
      score += 32;
      break;
    case "Disciplinary":
      score += 45;
      break;
    default:
      break;
  }

  if (failedLoginCount > 0) score += Math.min(18, failedLoginCount * 6);
  if (activeSessions > 1) score += 15;
  if (overdue.isOverdue) score += overdue.tone === "danger" ? 22 : 14;

  return Math.min(100, score);
}

export function getRiskLevel(score = 0) {
  if (score >= 70) return { label: "Critical", tone: "danger" };
  if (score >= 45) return { label: "Watch", tone: "warning" };
  return { label: "Stable", tone: "success" };
}

export function generateTemporaryPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export function buildFormFromUser(user) {
  return {
    fullName: user?.fullName || "",
    role: user?.role || "Cashier",
    department: user?.department || ROLE_DEPARTMENTS[user?.role || "Cashier"]?.[0] || "Sales",
    email: user?.email || "",
    phone: user?.phone || "",
    shiftAssignment: user?.shiftAssignment || getDefaultShiftForRole(user?.role || "Cashier"),
  };
}

export function createDefaultTimetable(shiftAssignment = "Flexible") {
  const shift = String(shiftAssignment || "Flexible").trim() || "Flexible";
  const baseTimes = {
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

  const window = baseTimes[shift] || baseTimes.Flexible;
  return Object.fromEntries(
    TIMETABLE_DAYS.map((day, index) => [
      day.key,
      {
        active: shift !== "Off" && index < 5,
        shift,
        start: window.start,
        end: window.end,
      },
    ])
  );
}

export function normalizeTimetable(timetable, shiftAssignment = "Flexible") {
  const fallback = createDefaultTimetable(shiftAssignment);
  const source = timetable && typeof timetable === "object" ? timetable : {};

  return Object.fromEntries(
    TIMETABLE_DAYS.map((day) => {
      const next = source[day.key] && typeof source[day.key] === "object" ? source[day.key] : {};
      return [
        day.key,
        {
          active: Boolean(next.active ?? fallback[day.key].active),
          shift: SHIFT_OPTIONS.includes(String(next.shift || "").trim())
            ? String(next.shift).trim()
            : fallback[day.key].shift,
          start: /^\d{2}:\d{2}$/.test(String(next.start || "")) ? String(next.start) : fallback[day.key].start,
          end: /^\d{2}:\d{2}$/.test(String(next.end || "")) ? String(next.end) : fallback[day.key].end,
        },
      ];
    })
  );
}
