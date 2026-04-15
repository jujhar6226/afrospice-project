import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import SoftPagination from "./shared/SoftPagination";
import {
  EVENT_FILTERS,
  INCIDENT_FLAGS,
  ROLE_DEPARTMENTS,
  SESSION_FILTERS,
  SHIFT_OPTIONS,
  TIMETABLE_DAYS,
  buildFormFromUser,
  createDefaultTimetable,
  emptyForm,
  formatAuditTime,
  formatPersonName,
  formatRelativeTime,
  generateTemporaryPin,
  getDefaultShiftForRole,
  getRiskLevel,
  getRiskScore,
  getStatusTone,
  normalizeOversightResponse,
  normalizeSingleUserResponse,
  normalizeTimetable,
  normalizeUsersResponse,
} from "./users/shared";
import { getIdentityTone } from "./shared/identityAvatar";

function classifyAccessEvent(event = {}) {
  const eventType = String(event.eventType || "").toLowerCase();

  if (eventType.includes("login") || eventType.includes("sign") || eventType.includes("pin")) {
    return "Security";
  }

  if (eventType.includes("access")) {
    return "Access";
  }

  if (eventType.includes("profile") || eventType.includes("record") || eventType.includes("workforce")) {
    return "Profile";
  }

  return "All";
}

function toMinutes(value = "") {
  const [hours, minutes] = String(value || "00:00")
    .split(":")
    .map((part) => Number(part || 0));
  return hours * 60 + minutes;
}

function formatClock(value = "") {
  if (!value) return "--:--";
  const [hours, minutes] = String(value || "00:00").split(":");
  const hourNumber = Number(hours || 0);
  const suffix = hourNumber >= 12 ? "PM" : "AM";
  const displayHour = hourNumber % 12 || 12;
  return `${displayHour}:${minutes || "00"} ${suffix}`;
}

const AUDIT_PAGE_SIZE = 6;

function buildPermissionGroups(role = "") {
  const normalizedRole = String(role || "").toLowerCase();

  if (normalizedRole === "owner") {
    return [
      { label: "User invitations", note: "Can create, approve, suspend, and delete staff records.", enabled: true },
      { label: "Inventory control", note: "Full stock and supplier command visibility.", enabled: true },
      { label: "Order operations", note: "Can monitor, edit, and reconcile order records.", enabled: true },
      { label: "Reporting", note: "Can open executive reporting and forecasting views.", enabled: true },
      { label: "Settings access", note: "Can manage workspace configuration and security.", enabled: true },
      { label: "Checkout access", note: "Can access live terminal controls when needed.", enabled: true },
    ];
  }

  if (normalizedRole === "manager") {
    return [
      { label: "User invitations", note: "Can review and manage most staff records.", enabled: true },
      { label: "Inventory control", note: "Can inspect stock and operational movements.", enabled: true },
      { label: "Order operations", note: "Can monitor and manage the order ledger.", enabled: true },
      { label: "Reporting", note: "Can review business performance and trends.", enabled: true },
      { label: "Settings access", note: "Limited to day-to-day operational controls.", enabled: false },
      { label: "Checkout access", note: "Can assist with live lane and cashier issues.", enabled: true },
    ];
  }

  if (normalizedRole === "inventory clerk") {
    return [
      { label: "User invitations", note: "Cannot create or approve user accounts.", enabled: false },
      { label: "Inventory control", note: "Primary focus for stock, counts, and receiving.", enabled: true },
      { label: "Order operations", note: "Can review order context when stock is involved.", enabled: true },
      { label: "Reporting", note: "Limited to operational inventory views.", enabled: false },
      { label: "Settings access", note: "No workspace-level settings access.", enabled: false },
      { label: "Checkout access", note: "Usually not a live terminal operator.", enabled: false },
    ];
  }

  return [
    { label: "User invitations", note: "Cannot create or approve other accounts.", enabled: false },
    { label: "Inventory control", note: "Can view stock only when role requires it.", enabled: false },
    { label: "Order operations", note: "Can work inside the lane and customer ledger.", enabled: true },
    { label: "Reporting", note: "Access is limited to summary visibility.", enabled: false },
    { label: "Settings access", note: "No workspace configuration access.", enabled: false },
    { label: "Checkout access", note: "Primary live selling surface for this role.", enabled: true },
  ];
}

function UserManagementDesk({ currentUser }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { userId } = useParams();
  const isCreateMode = userId === "new" || location.pathname.endsWith("/users/staff/new");
  const selectedUserId = isCreateMode ? null : userId;
  const isOwner = String(currentUser?.role || "") === "Owner";
  const roleOptions = useMemo(() => Object.keys(ROLE_DEPARTMENTS), []);

  const [user, setUser] = useState(null);
  const [oversight, setOversight] = useState({ summary: {}, sessions: [], events: [] });
  const [staffOptions, setStaffOptions] = useState([]);
  const [formData, setFormData] = useState({
    ...emptyForm,
    department: ROLE_DEPARTMENTS.Cashier[0],
    shiftAssignment: getDefaultShiftForRole("Cashier"),
  });
  const [casebookDraft, setCasebookDraft] = useState({
    shiftAssignment: getDefaultShiftForRole("Cashier"),
    staffNotes: "",
    incidentFlag: "Clear",
    incidentNote: "",
    isPinned: false,
  });
  const [timetable, setTimetable] = useState(createDefaultTimetable(getDefaultShiftForRole("Cashier")));
  const [sessionFilter, setSessionFilter] = useState("All");
  const [eventFilter, setEventFilter] = useState("All");
  const [sessionPage, setSessionPage] = useState(1);
  const [eventPage, setEventPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionLoading, setActionLoading] = useState("");
  const [pinDraft, setPinDraft] = useState("");
  const [generatedPin, setGeneratedPin] = useState("");
  const [copySourceId, setCopySourceId] = useState("");
  const [activeDetailTab, setActiveDetailTab] = useState("users-profile-board");
  const [error, setError] = useState("");
  const [banner, setBanner] = useState("");

  const assistantActionLabel = location.state?.assistantActionLabel || "";
  const assistantActionNote = location.state?.assistantActionNote || "";

  const hydrateFromUser = useCallback((nextUser, nextOversight = null) => {
    setUser(nextUser);
    setFormData(buildFormFromUser(nextUser));
    setCasebookDraft({
      shiftAssignment: nextUser?.shiftAssignment || getDefaultShiftForRole(nextUser?.role || "Cashier"),
      staffNotes: nextUser?.staffNotes || "",
      incidentFlag: nextUser?.incidentFlag || "Clear",
      incidentNote: nextUser?.incidentNote || "",
      isPinned: Boolean(nextUser?.isPinned),
    });
    setTimetable(normalizeTimetable(nextUser?.timetable, nextUser?.shiftAssignment || nextUser?.role || "Flexible"));
    if (nextOversight) {
      setOversight(nextOversight);
    }
  }, []);

  const fetchUserRecord = useCallback(async (targetUserId) => {
    try {
      const res = await API.get(`/users/${targetUserId}`);
      const nextUser = normalizeSingleUserResponse(res?.data);
      if (nextUser) {
        return nextUser;
      }
    } catch (requestError) {
      const status = Number(requestError?.status || requestError?.response?.status || 0);
      const message = String(requestError?.message || "").toLowerCase();
      const missingSingleRoute = status === 404 || message.includes("route not found");

      if (!missingSingleRoute) {
        throw requestError;
      }
    }

    const listRes = await API.get("/users");
    const nextUsers = normalizeUsersResponse(listRes?.data);
    return nextUsers.find((entry) => String(entry.id) === String(targetUserId)) || null;
  }, []);

  const fetchUserOversight = useCallback(async (targetUserId) => {
    try {
      const res = await API.get(`/users/${targetUserId}/oversight`);
      return normalizeOversightResponse(res?.data);
    } catch (requestError) {
      const status = Number(requestError?.status || requestError?.response?.status || 0);
      const message = String(requestError?.message || "").toLowerCase();
      const missingOversightRoute = status === 404 || message.includes("route not found");

      if (!missingOversightRoute) {
        throw requestError;
      }

      return { summary: {}, sessions: [], events: [] };
    }
  }, []);

  const loadStaffOptions = useCallback(async () => {
    try {
      const res = await API.get("/users");
      setStaffOptions(normalizeUsersResponse(res?.data));
    } catch (requestError) {
      console.error("Staff options load failed:", requestError);
    }
  }, []);

  const loadStaff = useCallback(async () => {
    if (isCreateMode) {
      setUser(null);
      setOversight({ summary: {}, sessions: [], events: [] });
      setError("");
      setBanner("");
      setGeneratedPin("");
      setCopySourceId("");
      setFormData({
        ...emptyForm,
        department: ROLE_DEPARTMENTS.Cashier[0],
        shiftAssignment: getDefaultShiftForRole("Cashier"),
      });
      setCasebookDraft({
        shiftAssignment: getDefaultShiftForRole("Cashier"),
        staffNotes: "",
        incidentFlag: "Clear",
        incidentNote: "",
        isPinned: false,
      });
      setTimetable(createDefaultTimetable(getDefaultShiftForRole("Cashier")));
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const [nextUser, nextOversight] = await Promise.all([
        fetchUserRecord(selectedUserId),
        fetchUserOversight(selectedUserId),
      ]);
      if (!nextUser) {
        throw new Error("Could not load the selected staff record.");
      }
      hydrateFromUser(nextUser, nextOversight);
      setError("");
    } catch (requestError) {
      console.error("User management load failed:", requestError);
      setError(requestError?.message || "Could not load the staff management desk.");
    } finally {
      setLoading(false);
    }
  }, [fetchUserOversight, fetchUserRecord, hydrateFromUser, isCreateMode, selectedUserId]);

  useEffect(() => {
    loadStaff();
  }, [loadStaff]);

  useEffect(() => {
    loadStaffOptions();
  }, [loadStaffOptions]);

  useEffect(() => {
    setActiveDetailTab("users-profile-board");
  }, [isCreateMode, selectedUserId]);

  const selectedDepartmentOptions = ROLE_DEPARTMENTS[formData.role] || [];
  const summary = oversight?.summary || user?.oversight || {};
  const scheduleSources = useMemo(
    () => staffOptions.filter((staffOption) => String(staffOption.id) !== String(user?.id || "")),
    [staffOptions, user?.id]
  );
  const filteredSessions = useMemo(() => {
    const sessions = oversight?.sessions || [];
    if (sessionFilter === "All") return sessions;
    if (sessionFilter === "Active") {
      return sessions.filter((session) => String(session.status || "").toLowerCase() === "active" && !session.logoutAt);
    }
    return sessions.filter((session) => session.logoutAt || String(session.status || "").toLowerCase() !== "active");
  }, [oversight?.sessions, sessionFilter]);
  const filteredEvents = useMemo(() => {
    const events = oversight?.events || [];
    if (eventFilter === "All") return events;
    return events.filter((event) => classifyAccessEvent(event) === eventFilter);
  }, [eventFilter, oversight?.events]);

  useEffect(() => {
    setSessionPage(1);
  }, [sessionFilter, filteredSessions.length, user?.id]);

  useEffect(() => {
    setEventPage(1);
  }, [eventFilter, filteredEvents.length, user?.id]);

  const riskScore = getRiskScore(user || {});
  const riskLevel = getRiskLevel(riskScore);
  const weekTimeline = useMemo(
    () =>
      TIMETABLE_DAYS.map((day) => {
        const fallbackDay = createDefaultTimetable(casebookDraft.shiftAssignment)[day.key];
        const daySchedule = timetable[day.key] || fallbackDay;
        const startMinutes = toMinutes(daySchedule.start);
        const endMinutes = Math.max(startMinutes + 30, toMinutes(daySchedule.end));
        const left = `${(startMinutes / 1440) * 100}%`;
        const width = `${Math.max(((endMinutes - startMinutes) / 1440) * 100, 4)}%`;

        return {
          ...day,
          ...daySchedule,
          left,
          width,
          rangeLabel: daySchedule.active
            ? `${formatClock(daySchedule.start)} - ${formatClock(daySchedule.end)}`
            : "Off schedule",
        };
      }),
    [casebookDraft.shiftAssignment, timetable]
  );
  const activeScheduleDays = useMemo(
    () => weekTimeline.filter((day) => day.active).length,
    [weekTimeline]
  );
  const scheduleRangeLabel = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      }),
    []
  );
  const recentEventsPreview = useMemo(() => (oversight?.events || []).slice(0, 4), [oversight?.events]);

  const sessionTotalPages = Math.max(1, Math.ceil(filteredSessions.length / AUDIT_PAGE_SIZE));
  const activeSessionPage = Math.min(sessionPage, sessionTotalPages);
  const pagedSessions = filteredSessions.slice(
    (activeSessionPage - 1) * AUDIT_PAGE_SIZE,
    activeSessionPage * AUDIT_PAGE_SIZE
  );

  const eventTotalPages = Math.max(1, Math.ceil(filteredEvents.length / AUDIT_PAGE_SIZE));
  const activeEventPage = Math.min(eventPage, eventTotalPages);
  const pagedEvents = filteredEvents.slice(
    (activeEventPage - 1) * AUDIT_PAGE_SIZE,
    activeEventPage * AUDIT_PAGE_SIZE
  );

  const handleFieldChange = (field, value) => {
    if (field === "role") {
      const nextRole = String(value || "");
      const allowedDepartments = ROLE_DEPARTMENTS[nextRole] || [];
      const nextShift = getDefaultShiftForRole(nextRole);
      setFormData((previous) => ({
        ...previous,
        role: nextRole,
        department: allowedDepartments.includes(previous.department) ? previous.department : allowedDepartments[0] || "",
      }));
      setCasebookDraft((previous) => ({
        ...previous,
        shiftAssignment: nextShift,
      }));
      setTimetable(createDefaultTimetable(nextShift));
      return;
    }

    setFormData((previous) => ({
      ...previous,
      [field]: field === "fullName" ? formatPersonName(value) : value,
    }));
  };

  const updateCasebookField = (field, value) => {
    setCasebookDraft((previous) => {
      const next = {
        ...previous,
        [field]: value,
      };

      if (field === "shiftAssignment") {
        setTimetable((current) =>
          normalizeTimetable(
            Object.fromEntries(
              Object.entries(current).map(([dayKey, dayValue]) => [
                dayKey,
                {
                  ...dayValue,
                  shift: value,
                },
              ])
            ),
            value
          )
        );
      }

      return next;
    });
  };

  const handleTimetableChange = (dayKey, field, value) => {
    setTimetable((previous) => ({
      ...previous,
      [dayKey]: {
        ...previous[dayKey],
        [field]: field === "active" ? Boolean(value) : value,
      },
    }));
  };

  const applyWeekdayPattern = () => {
    setTimetable((previous) => {
      const next = { ...previous };
      TIMETABLE_DAYS.forEach((day, index) => {
        next[day.key] = {
          ...next[day.key],
          active: index < 5,
          shift: casebookDraft.shiftAssignment,
        };
      });
      return next;
    });
  };

  const handleCopySchedule = () => {
    const source = scheduleSources.find((staffOption) => String(staffOption.id) === String(copySourceId));
    if (!source) {
      setError("Choose a staff record to copy the schedule from.");
      return;
    }

    const nextShift = source.shiftAssignment || casebookDraft.shiftAssignment || "Flexible";
    setCasebookDraft((previous) => ({
      ...previous,
      shiftAssignment: nextShift,
    }));
    setTimetable(normalizeTimetable(source.timetable, nextShift));
    setBanner(`Weekly timetable copied from ${source.fullName}. Save the timetable to keep it.`);
    setError("");
  };

  const refreshEditData = useCallback(async () => {
    if (!user?.id) return;
    const [nextUser, nextOversight] = await Promise.all([
      fetchUserRecord(user.id),
      fetchUserOversight(user.id),
    ]);
    if (nextUser) {
      hydrateFromUser(nextUser, nextOversight);
    }
  }, [fetchUserOversight, fetchUserRecord, hydrateFromUser, user?.id]);

  const handleSaveProfile = async (event) => {
    event.preventDefault();

    const payload = {
      ...formData,
      shiftAssignment: casebookDraft.shiftAssignment,
      staffNotes: casebookDraft.staffNotes,
      incidentFlag: casebookDraft.incidentFlag,
      incidentNote: casebookDraft.incidentNote,
      isPinned: casebookDraft.isPinned,
      timetable,
    };

    try {
      setSaving(true);
      setError("");
      setBanner("");

      if (isCreateMode) {
        const res = await API.post("/users", payload);
        const createdUser = normalizeSingleUserResponse(res?.data);
        if (!createdUser?.id) {
          throw new Error("Staff record created but could not open the management page.");
        }
        navigate(`/users/staff/${createdUser.id}`, {
          replace: true,
          state: {
            assistantActionLabel: "Staff management desk is ready",
            assistantActionNote: `Continue with PIN issue, approval, and timetable checks for ${createdUser.fullName}.`,
          },
        });
        return;
      }

      await API.put(`/users/${user.id}`, payload);
      await refreshEditData();
      setBanner(`${payload.fullName || user.fullName} updated successfully.`);
    } catch (submitError) {
      console.error("Saving staff failed:", submitError);
      setError(submitError?.message || "Failed to save the staff record.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveTimetable = async () => {
    if (!user?.id) return;

    try {
      setSaving(true);
      setError("");
      await API.patch(`/users/${user.id}/workforce-profile`, {
        shiftAssignment: casebookDraft.shiftAssignment,
        staffNotes: casebookDraft.staffNotes,
        incidentFlag: casebookDraft.incidentFlag,
        incidentNote: casebookDraft.incidentNote,
        isPinned: casebookDraft.isPinned,
        timetable,
      });
      await refreshEditData();
      setBanner(`Weekly timetable saved for ${user.fullName}.`);
    } catch (saveError) {
      console.error("Saving timetable failed:", saveError);
      setError(saveError?.message || "Failed to save the weekly timetable.");
    } finally {
      setSaving(false);
    }
  };

  const handleAssignPin = async () => {
    if (!user?.id) return;
    if (!/^\d{4,6}$/.test(pinDraft)) {
      setError("PIN must use 4-6 digits.");
      return;
    }

    try {
      setActionLoading("pin");
      setError("");
      await API.post(`/users/${user.id}/pin`, { pin: pinDraft });
      setGeneratedPin(pinDraft);
      setPinDraft("");
      await refreshEditData();
      setBanner(`Temporary PIN issued for ${user.fullName}: ${pinDraft}. The user must change it on first login.`);
    } catch (pinError) {
      console.error("Assigning PIN failed:", pinError);
      setError(pinError?.message || "Failed to issue the PIN.");
    } finally {
      setActionLoading("");
    }
  };

  const handleApproveAccess = async () => {
    if (!user?.id) return;

    try {
      setActionLoading("approve");
      setError("");
      await API.post(`/users/${user.id}/approve`);
      await refreshEditData();
      setBanner(`${user.fullName} is now approved for live sign-in.`);
    } catch (approveError) {
      console.error("Approving access failed:", approveError);
      setError(approveError?.message || "Failed to approve access.");
    } finally {
      setActionLoading("");
    }
  };

  const handleToggleStatus = async (nextStatus) => {
    if (!user?.id) return;

    try {
      setActionLoading(nextStatus.toLowerCase());
      setError("");
      await API.patch(`/users/${user.id}/status`, { status: nextStatus });
      await refreshEditData();
      setBanner(`${user.fullName} is now ${nextStatus.toLowerCase()}.`);
    } catch (statusError) {
      console.error("Updating access failed:", statusError);
      setError(statusError?.message || "Failed to update access status.");
    } finally {
      setActionLoading("");
    }
  };

  const handleDelete = async () => {
    if (!user?.id) return;
    if (!window.confirm(`Delete ${user.fullName}? This cannot be undone.`)) return;

    try {
      setActionLoading("delete");
      setError("");
      await API.delete(`/users/${user.id}`);
      navigate("/users", {
        replace: true,
        state: {
          assistantActionLabel: "Staff record removed",
          assistantActionNote: `${user.fullName} was deleted from the workforce roster.`,
        },
      });
    } catch (deleteError) {
      console.error("Deleting user failed:", deleteError);
      setError(deleteError?.message || "Failed to delete the staff record.");
    } finally {
      setActionLoading("");
    }
  };

  const handleUserAuditExport = async () => {
    if (!user?.id) return;

    try {
      setError("");
      const res = await API.get(`/users/${user.id}/audit-export`, { responseType: "blob" });
      const blob = new Blob([res.data], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `afrospice-user-audit-${String(user.staffId || "staff").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setBanner(`${user.fullName} audit export downloaded.`);
    } catch (exportError) {
      console.error("Export single user audit failed:", exportError);
      setError(exportError?.message || "Failed to export this user audit.");
    }
  };

  const detailTabs = [
    { label: "Profile", target: "users-profile-board" },
    { label: "Permissions", target: "users-permissions-board" },
    { label: "Schedule", target: "users-schedule-board" },
    ...(!isCreateMode ? [{ label: "Activity Log", target: "users-activity-board" }] : []),
    ...(!isCreateMode ? [{ label: "Security Settings", target: "users-security-board" }] : []),
  ];

  const profileName = String(formData.fullName || user?.fullName || "Staff member");
  const profileEmail = String(formData.email || user?.email || "No email on file");
  const profileRole = String(formData.role || user?.role || "Cashier");
  const profileDepartment = String(formData.department || user?.department || "Department");
  const accountStatus = String(user?.status || "Pending Approval");
  const lastSeenLabel = formatRelativeTime(summary.lastSeenAt || summary.lastLoginAt);
  const profileInitials =
    String(profileName || "Staff")
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "ST";
  const permissionCards = buildPermissionGroups(formData.role || user?.role);
  const profileTone = getIdentityTone(profileName, "blue");

  if (loading) {
    return <div className="app-boot-shell">Loading staff management...</div>;
  }

  return (
    <div className="page-container users-management-page">
      <section className="users-management-detail-hero">
        <div className="users-management-detail-copy">
          {!isCreateMode ? (
            <div className="users-management-breadcrumbs">
              <button type="button" onClick={() => navigate("/users")}>User Management</button>
              <span>/</span>
              <strong>{profileName}</strong>
            </div>
          ) : null}
          <div className="users-management-detail-identity">
            <div className="users-management-detail-avatar" data-tone={profileTone}>{profileInitials}</div>
            <div className="users-management-detail-meta">
              <span className="reference-page-kicker">User Management</span>
              <h1>{isCreateMode ? "Create Staff Record" : profileName}</h1>
              <p>{profileEmail}</p>
              <div className="users-management-detail-pills">
                <span className="status-pill neutral">{profileRole}</span>
                <span className="status-pill neutral">{profileDepartment}</span>
                {!isCreateMode ? <span className={`status-pill ${getStatusTone(accountStatus)}`}>{accountStatus}</span> : null}
                {!isCreateMode ? <span className={`status-pill ${riskLevel.tone}`}>{riskLevel.label}</span> : null}
              </div>
              <div className="users-management-detail-facts">
                <span>{user?.staffId || "Assigned on save"}</span>
                <span>{isCreateMode ? "Set profile, permissions, and schedule before creating the record." : `Last active ${lastSeenLabel}`}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="users-management-detail-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate("/users")}>
            Back To Workforce
          </button>
          {!isCreateMode ? (
            <button type="button" className="btn btn-secondary" onClick={handleUserAuditExport}>
              Export Audit
            </button>
          ) : null}
          {!isCreateMode ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleToggleStatus(accountStatus === "Active" ? "Inactive" : "Active")}
              disabled={!isOwner || actionLoading === "active" || actionLoading === "inactive" || String(user?.id) === String(currentUser?.id)}
            >
              {accountStatus === "Active" ? "Suspend User" : "Activate User"}
            </button>
          ) : null}
        </div>
      </section>

      <AssistantActionBanner label={assistantActionLabel} note={assistantActionNote} />
      {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}
      {banner ? <div className="info-banner">{banner}</div> : null}

      <section className="users-management-tabs users-management-tabs--detail">
        {detailTabs.map((tab) => (
          <button
            key={tab.target}
            type="button"
            className={activeDetailTab === tab.target ? "users-management-tab is-active" : "users-management-tab"}
            onClick={() => setActiveDetailTab(tab.target)}
          >
            {tab.label}
          </button>
        ))}
      </section>

      {activeDetailTab === "users-profile-board" ? (
        <>
          <div id="users-profile-board" className="users-management-detail-grid">
            <section className="panel clean-panel ops-section users-management-panel">
          <div className="ops-section__header">
            <div>
              <p className="eyebrow">Profile</p>
              <h3>User information</h3>
              <p className="panel-subtitle">Update the staff identity, department placement, and operating notes.</p>
            </div>
          </div>
          <form className="stack-form" onSubmit={handleSaveProfile}>
            <div className="form-two-col">
              <label className="users-control-label">
                <span>Staff ID</span>
                <input className="input" value={user?.staffId || "Assigned on save"} readOnly />
              </label>
              <label className="users-control-label">
                <span>Full Name</span>
                <input className="input" value={formData.fullName} onChange={(event) => handleFieldChange("fullName", event.target.value)} disabled={!isOwner} />
              </label>
            </div>
            <div className="form-two-col">
              <label className="users-control-label">
                <span>Email</span>
                <input className="input" value={formData.email} onChange={(event) => handleFieldChange("email", event.target.value)} disabled={!isOwner} />
              </label>
              <label className="users-control-label">
                <span>Phone</span>
                <input className="input" value={formData.phone} onChange={(event) => handleFieldChange("phone", event.target.value)} disabled={!isOwner} />
              </label>
            </div>
            <div className="form-two-col">
              <label className="users-control-label">
                <span>Role</span>
                <select className="input" value={formData.role} onChange={(event) => handleFieldChange("role", event.target.value)} disabled={!isOwner}>
                  {roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
                </select>
              </label>
              <label className="users-control-label">
                <span>Department</span>
                <select className="input" value={formData.department} onChange={(event) => handleFieldChange("department", event.target.value)} disabled={!isOwner}>
                  {selectedDepartmentOptions.map((department) => <option key={department} value={department}>{department}</option>)}
                </select>
              </label>
            </div>
            <div className="form-two-col">
              <label className="users-control-label">
                <span>Primary Shift</span>
                <select className="input" value={casebookDraft.shiftAssignment} onChange={(event) => updateCasebookField("shiftAssignment", event.target.value)} disabled={!isOwner}>
                  {SHIFT_OPTIONS.map((shift) => <option key={shift} value={shift}>{shift}</option>)}
                </select>
              </label>
              <label className="users-control-label">
                <span>Risk Flag</span>
                <select className="input" value={casebookDraft.incidentFlag} onChange={(event) => updateCasebookField("incidentFlag", event.target.value)} disabled={!isOwner}>
                  {INCIDENT_FLAGS.map((flag) => <option key={flag} value={flag}>{flag}</option>)}
                </select>
              </label>
            </div>
            <label className="users-control-label">
              <span>Staff Notes</span>
              <textarea className="input textarea" value={casebookDraft.staffNotes} onChange={(event) => updateCasebookField("staffNotes", event.target.value)} disabled={!isOwner} />
            </label>
            <label className="users-control-label">
              <span>Risk Note</span>
              <textarea className="input textarea" value={casebookDraft.incidentNote} onChange={(event) => updateCasebookField("incidentNote", event.target.value)} disabled={!isOwner} />
            </label>
            <div className="form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving || !isOwner}>
                {saving ? "Saving..." : isCreateMode ? "Create Staff Record" : "Save Changes"}
              </button>
            </div>
          </form>
            </section>

            <div className="users-management-detail-side">
              <section className="panel clean-panel ops-section users-management-panel">
              <div className="ops-section__header">
                <div>
                  <p className="eyebrow">Security Snapshot</p>
                  <h3>Access posture and sign-in state</h3>
                  <p className="panel-subtitle">Keep activation, PIN status, and recent access visible from the main profile tab.</p>
                </div>
              </div>
              <div className="users-access-signal-strip">
                <article className="users-signal-card">
                  <span>Account State</span>
                  <strong>{accountStatus}</strong>
                  <p>{accountStatus === "Active" ? "Workspace access is currently live for this record." : "Access is restricted until activation is restored."}</p>
                </article>
                <article className="users-signal-card">
                  <span>PIN Posture</span>
                  <strong>{user?.pinStatus || "Not Set"}</strong>
                  <p>Temporary PIN management stays inside Security Settings.</p>
                </article>
                <article className="users-signal-card">
                  <span>Last Active</span>
                  <strong>{lastSeenLabel}</strong>
                  <p>{Number(summary.failedLoginCount7d || 0)} failed sign-ins recorded in the last 7 days.</p>
                </article>
              </div>
              {!isCreateMode ? (
                <div className="users-management-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setActiveDetailTab("users-security-board")}>
                    Open Security Settings
                  </button>
                  <button type="button" className="btn btn-secondary" onClick={() => setActiveDetailTab("users-schedule-board")}>
                    Open Schedule
                  </button>
                </div>
              ) : null}
            </section>

              {!isCreateMode ? (
                <section className="panel clean-panel ops-section users-management-panel">
                  <div className="ops-section__header">
                    <div>
                      <p className="eyebrow">Recent Activity</p>
                      <h3>Latest staff movement</h3>
                      <p className="panel-subtitle">The newest access and workflow events tied to this staff record.</p>
                    </div>
                  </div>
                  <div className="users-event-list users-event-list--preview">
                    {recentEventsPreview.length ? recentEventsPreview.map((event) => (
                      <article key={event.id} className="users-event-item">
                        <div>
                          <strong>{event.title}</strong>
                          <small>{event.actorName || "System"}</small>
                        </div>
                        <p>{event.message}</p>
                        <span>{formatAuditTime(event.createdAt)}</span>
                      </article>
                    )) : <div className="users-timeline-empty">No access events have been recorded yet.</div>}
                  </div>
                  <div className="users-management-actions">
                    <button type="button" className="btn btn-secondary" onClick={() => setActiveDetailTab("users-activity-board")}>
                      Open Activity Log
                    </button>
                  </div>
                </section>
              ) : null}
            </div>
          </div>

          <section className="panel clean-panel ops-section users-management-panel users-management-schedule-preview">
            <div className="ops-section__header">
              <div>
                <p className="eyebrow">Schedule</p>
                <h3>Weekly schedule preview</h3>
                <p className="panel-subtitle">A quick read on the assigned week before you open the full scheduling studio.</p>
              </div>
            </div>
            <div className="users-management-preview-list">
              {weekTimeline.map((day) => (
                <article key={day.key} className={`users-management-preview-row ${day.active ? "is-active" : "is-off"}`}>
                  <div className="users-management-preview-meta">
                    <strong>{day.label}</strong>
                    <small>{day.shift}</small>
                  </div>
                  <span>{day.rangeLabel}</span>
                </article>
              ))}
            </div>
            <div className="users-management-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setActiveDetailTab("users-schedule-board")}>
                Manage Schedule
              </button>
            </div>
          </section>
        </>
      ) : null}

      {activeDetailTab === "users-permissions-board" ? (
        <section id="users-permissions-board" className="panel clean-panel ops-section users-management-panel users-permissions-board">
          <div className="ops-section__header">
            <div>
              <p className="eyebrow">Permissions</p>
              <h3>Role-based access and operating coverage</h3>
              <p className="panel-subtitle">This section reflects how the selected role is expected to behave across the workspace.</p>
            </div>
          </div>
          <div className="users-access-signal-strip">
            <article className="users-signal-card">
              <span>Assigned Role</span>
              <strong>{profileRole}</strong>
              <p>{profileDepartment} is the primary operating lane for this staff member.</p>
            </article>
            <article className="users-signal-card">
              <span>Enabled Controls</span>
              <strong>{permissionCards.filter((permission) => permission.enabled).length}</strong>
              <p>{permissionCards.length} access categories are being evaluated for this role.</p>
            </article>
            <article className="users-signal-card">
              <span>Risk View</span>
              <strong>{riskLevel.label}</strong>
              <p>Escalate permissions review when monitoring state or incident flags change.</p>
            </article>
          </div>
          <div className="users-permissions-grid">
            {permissionCards.map((permission) => (
              <article key={permission.label} className="users-permission-card">
                <div>
                  <strong>{permission.label}</strong>
                  <small>{permission.note}</small>
                </div>
                <span className={`status-pill small ${permission.enabled ? "success" : "neutral"}`}>
                  {permission.enabled ? "Enabled" : "Limited"}
                </span>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {activeDetailTab === "users-schedule-board" ? (
        <section id="users-schedule-board" className="panel clean-panel ops-section users-management-panel users-schedule-studio">
          <div className="ops-section__header wrap-header">
            <div>
              <p className="eyebrow">Schedule</p>
              <h3>Weekly work schedule</h3>
              <p className="panel-subtitle">Set the staff week clearly, keep shifts readable, and publish one clean schedule.</p>
            </div>
            <div className="users-management-hero-actions compact users-schedule-tools">
              <select className="input users-copy-select" value={copySourceId} onChange={(event) => setCopySourceId(event.target.value)}>
                <option value="">Copy schedule from staff...</option>
                {scheduleSources.map((staffOption) => (
                  <option key={staffOption.id} value={staffOption.id}>
                    {staffOption.fullName} - {staffOption.shiftAssignment || "Flexible"}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-secondary small" onClick={handleCopySchedule} disabled={!copySourceId}>Copy Last Week</button>
              <button type="button" className="btn btn-secondary small" onClick={applyWeekdayPattern} disabled={!isOwner}>Apply Weekday Pattern</button>
              {!isCreateMode ? <button type="button" className="btn btn-primary small" onClick={handleSaveTimetable} disabled={!isOwner || saving}>{saving ? "Saving..." : "Save Schedule"}</button> : null}
            </div>
          </div>

          <section className="users-schedule-sheet">
            <div className="users-schedule-sheet-head">
              <div className="users-schedule-sheet-head-copy">
                <p className="eyebrow">Weekly Work Schedule</p>
                <h3>Assigned weekly coverage</h3>
                <div className="users-schedule-sheet-date">
                  <span>{scheduleRangeLabel}</span>
                  <small>{activeScheduleDays} active days</small>
                </div>
              </div>
              <div className="users-schedule-sheet-head-actions">
                <button type="button" className="btn btn-secondary btn-compact" onClick={handleCopySchedule} disabled={!copySourceId}>
                  Copy Last Week
                </button>
              </div>
            </div>

            <div className="users-schedule-table">
              <div className="users-schedule-table-head">
                <span>Day</span>
                <span>Shift</span>
                <span>Start</span>
                <span>End</span>
                <span>Time</span>
              </div>

              <div className="users-schedule-table-body">
                {TIMETABLE_DAYS.map((day) => {
                  const daySchedule = timetable[day.key] || createDefaultTimetable(casebookDraft.shiftAssignment)[day.key];
                  return (
                    <article key={day.key} className={`users-schedule-table-row ${daySchedule.active ? "is-active" : "is-off"}`}>
                      <label className="users-schedule-daycell">
                        <input
                          type="checkbox"
                          checked={Boolean(daySchedule.active)}
                          onChange={(event) => handleTimetableChange(day.key, "active", event.target.checked)}
                          disabled={!isOwner}
                        />
                        <div>
                          <strong>{day.label}</strong>
                          <small>{daySchedule.active ? "Scheduled" : "Off shift"}</small>
                        </div>
                      </label>

                      <select
                        className="input"
                        value={daySchedule.shift}
                        onChange={(event) => handleTimetableChange(day.key, "shift", event.target.value)}
                        disabled={!isOwner}
                      >
                        {SHIFT_OPTIONS.map((shift) => <option key={shift} value={shift}>{shift}</option>)}
                      </select>

                      <input
                        className="input"
                        type="time"
                        value={daySchedule.start}
                        onChange={(event) => handleTimetableChange(day.key, "start", event.target.value)}
                        disabled={!isOwner || !daySchedule.active}
                      />

                      <input
                        className="input"
                        type="time"
                        value={daySchedule.end}
                        onChange={(event) => handleTimetableChange(day.key, "end", event.target.value)}
                        disabled={!isOwner || !daySchedule.active}
                      />

                      <div className={`users-schedule-window ${daySchedule.active ? "" : "is-off"}`}>
                        {daySchedule.active ? `${formatClock(daySchedule.start)} - ${formatClock(daySchedule.end)}` : "Not Set"}
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>

            <div className="users-schedule-sheet-footer">
              <div className="users-schedule-sheet-footer-copy">
                <span>{scheduleRangeLabel}</span>
                <small>
                  Showing {activeScheduleDays} scheduled day{activeScheduleDays === 1 ? "" : "s"} across the current week.
                </small>
              </div>
              <div className="users-schedule-sheet-footer-actions">
                <button type="button" className="btn btn-secondary" onClick={applyWeekdayPattern} disabled={!isOwner}>
                  Apply Weekday Pattern
                </button>
                {!isCreateMode ? (
                  <button type="button" className="btn btn-primary" onClick={handleSaveTimetable} disabled={!isOwner || saving}>
                    {saving ? "Saving..." : "Save Schedule"}
                  </button>
                ) : null}
              </div>
            </div>
          </section>

          <section className="users-schedule-review">
            <div className="users-schedule-review-head">
              <div>
                <p className="eyebrow">Weekly Work Schedule</p>
                <h3>Published week at a glance</h3>
                <p className="panel-subtitle">A cleaner read of the current live schedule before you leave this staff record.</p>
              </div>
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => setActiveDetailTab("users-security-board")}>
                Open Security
              </button>
            </div>

            <div className="users-schedule-review-list">
              {weekTimeline.map((day) => (
                <article key={day.key} className={`users-schedule-review-row ${day.active ? "is-active" : "is-off"}`}>
                  <div className="users-schedule-review-day">
                    <input type="checkbox" checked={Boolean(day.active)} readOnly />
                    <strong>{day.label}</strong>
                  </div>
                  <div className="users-schedule-review-time">
                    <span>{day.active ? formatClock(day.start) : "Not Set"}</span>
                    <span>{day.active ? formatClock(day.end) : "Not Set"}</span>
                  </div>
                </article>
              ))}
            </div>

            <div className="users-schedule-sheet-footer users-schedule-sheet-footer--secondary">
              <SoftPagination currentPage={1} totalPages={1} onChange={() => {}} />
              {!isCreateMode ? (
                <button type="button" className="btn btn-primary" onClick={handleSaveTimetable} disabled={!isOwner || saving}>
                  {saving ? "Saving..." : "Save Schedule"}
                </button>
              ) : null}
            </div>
          </section>
        </section>
      ) : null}

      {!isCreateMode && activeDetailTab === "users-activity-board" ? (
          <div id="users-activity-board" className="users-management-detail-activity-grid">
            <section id="users-session-board" className="panel clean-panel ops-section users-management-panel">
              <div className="users-timeline-head">
                <div>
                  <span>Schedule Activity</span>
                  <strong>{filteredSessions.length} tracked sessions</strong>
                </div>
                <select className="input users-timeline-filter" value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)}>
                  {SESSION_FILTERS.map((filter) => <option key={filter} value={filter}>{filter} sessions</option>)}
                </select>
              </div>
              <div className="users-session-list">
                {pagedSessions.length ? pagedSessions.map((session) => (
                  <article key={session.id} className="users-session-item">
                    <div>
                      <strong>{session.status}</strong>
                      <small>{formatAuditTime(session.loginAt)}</small>
                    </div>
                    <div className="users-session-meta">
                      <span>Last seen {formatRelativeTime(session.lastSeenAt)}</span>
                      <small>{session.logoutAt ? `Signed out ${formatRelativeTime(session.logoutAt)}` : "Session still active"}</small>
                    </div>
                  </article>
                )) : <div className="users-timeline-empty">No sessions match the current filter.</div>}
              </div>
              <SoftPagination currentPage={activeSessionPage} totalPages={sessionTotalPages} onChange={setSessionPage} />
            </section>

            <section id="users-events-board" className="panel clean-panel ops-section users-management-panel">
              <div className="users-timeline-head">
                <div>
                  <span>Activity Log</span>
                  <strong>{filteredEvents.length} events</strong>
                </div>
                <select className="input users-timeline-filter" value={eventFilter} onChange={(event) => setEventFilter(event.target.value)}>
                  {EVENT_FILTERS.map((filter) => <option key={filter} value={filter}>{filter} events</option>)}
                </select>
              </div>
              <div className="users-event-list">
                {pagedEvents.length ? pagedEvents.map((event) => (
                  <article key={event.id} className="users-event-item">
                    <div>
                      <strong>{event.title}</strong>
                      <small>{event.actorName || "System"}</small>
                    </div>
                    <p>{event.message}</p>
                    <span>{formatAuditTime(event.createdAt)}</span>
                  </article>
                )) : <div className="users-timeline-empty">No access events match the current filter.</div>}
              </div>
              <SoftPagination currentPage={activeEventPage} totalPages={eventTotalPages} onChange={setEventPage} />
            </section>
          </div>

      ) : null}

      {!isCreateMode && activeDetailTab === "users-security-board" ? (
        <>
          <section id="users-security-board" className="panel clean-panel ops-section users-management-panel">
            <div className="ops-section__header">
              <div>
                <p className="eyebrow">Security Settings</p>
                <h3>PIN, approval, and account control</h3>
                <p className="panel-subtitle">Manage access posture, activation state, and temporary credential flow.</p>
              </div>
            </div>
            {!isOwner ? <div className="users-drawer-readonly">Managers can review this page. Owner access is required to change PINs, approvals, statuses, or delete the record.</div> : null}
            <div className="users-access-signal-strip">
              <article className="users-signal-card">
                <span>Account State</span>
                <strong>{accountStatus}</strong>
                <p>{accountStatus === "Active" ? "This staff record can use the live workspace." : "Activation still depends on approval and current access posture."}</p>
              </article>
              <article className="users-signal-card">
                <span>PIN Posture</span>
                <strong>{user?.pinStatus || "Not Set"}</strong>
                <p>Issue or reset a temporary PIN when sign-in needs to be restored safely.</p>
              </article>
              <article className="users-signal-card">
                <span>Last Active</span>
                <strong>{lastSeenLabel}</strong>
                <p>{Number(summary.failedLoginCount7d || 0)} failed sign-ins recorded in the last 7 days.</p>
              </article>
            </div>
            <div className="users-management-pin-row">
              <input className="input" inputMode="numeric" placeholder="4-6 digit temporary PIN" value={pinDraft} onChange={(event) => setPinDraft(String(event.target.value || "").replace(/\D/g, "").slice(0, 6))} disabled={!isOwner} />
              <button type="button" className="btn btn-secondary" onClick={() => setPinDraft(generateTemporaryPin())} disabled={!isOwner}>Generate</button>
              <button type="button" className="btn btn-primary" onClick={handleAssignPin} disabled={!isOwner || actionLoading === "pin"}>
                {user?.pinStatus === "Assigned" ? "Set / Change PIN" : "Issue PIN"}
              </button>
            </div>
            {generatedPin ? <div className="users-management-placeholder users-pin-preview"><span>Temporary PIN</span><strong>{generatedPin}</strong><small>This is shown once. The staff member must replace it on first login.</small></div> : null}
            <div className="users-management-actions">
              <button type="button" className="btn btn-secondary" onClick={handleApproveAccess} disabled={!isOwner || user?.status !== "Pending Approval" || user?.pinStatus !== "Assigned" || actionLoading === "approve"}>Approve Access</button>
              <button type="button" className="btn btn-secondary" onClick={() => handleToggleStatus("Active")} disabled={!isOwner || user?.status === "Active" || actionLoading === "active"}>Activate</button>
              <button type="button" className="btn btn-secondary" onClick={() => handleToggleStatus("Inactive")} disabled={!isOwner || user?.status === "Inactive" || String(user?.id) === String(currentUser?.id) || actionLoading === "inactive"}>Deactivate</button>
            </div>
          </section>

          <section className="panel clean-panel ops-section users-management-panel users-management-danger-zone">
            <div className="ops-section__header">
              <div>
                <p className="eyebrow">Security Settings</p>
                <h3>Delete user</h3>
                <p className="panel-subtitle">Once deleted, this user account cannot be recovered.</p>
              </div>
            </div>
            <div className="users-management-danger-actions">
              <button type="button" className="btn btn-danger" onClick={handleDelete} disabled={!isOwner || String(user?.id) === String(currentUser?.id) || actionLoading === "delete"}>
                Delete User
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

export default UserManagementDesk;


