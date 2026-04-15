import { useState } from "react";
import {
  FaChartLine as FiActivity,
  FaClock as FiClock,
  FaFileLines as FiFileText,
  FaShieldHalved as FiShield,
  FaUser as FiUser,
  FaXmark as FiX,
} from "react-icons/fa6";
import { getIdentityInitials, getIdentityTone } from "../shared/identityAvatar";

function formatTimestamp(value) {
  if (!value) return "Not recorded yet";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Not recorded yet";
  return parsed.toLocaleString();
}

function getStatusTone(status = "") {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("active")) return "success";
  if (normalized.includes("pending")) return "warning";
  if (normalized.includes("inactive") || normalized.includes("suspend")) return "danger";
  return "neutral";
}

function getFlagTone(flag = "") {
  const normalized = String(flag || "").toLowerCase();
  if (normalized.includes("clear")) return "success";
  if (normalized.includes("watch") || normalized.includes("review")) return "warning";
  if (normalized.includes("critical") || normalized.includes("escalat")) return "danger";
  return "neutral";
}

function StaffCasebookModal({
  open,
  user,
  draft,
  incidentFlags,
  onChange,
  onClose,
  onSave,
  saving,
}) {
  const [activePanel, setActivePanel] = useState("casebook");

  if (!open || !user) return null;

  const sessionCount = Number(user?.oversight?.activeSessionCount || 0);
  const failedLoginCount = Number(user?.oversight?.failedLoginCount7d || 0);
  const panelTabs = [
    { id: "casebook", label: "Casebook" },
    { id: "access", label: "Access" },
    { id: "activity", label: "Activity" },
  ];

  const summaryCards = [
    {
      label: "Current Shift",
      value: draft.shiftAssignment || user.shiftAssignment || "Flexible",
      note: "Default staffing posture",
      icon: FiUser,
    },
    {
      label: "Access Status",
      value: user.status || "Pending Approval",
      note: user.pinStatus === "Assigned" ? "PIN already issued" : "PIN not issued yet",
      icon: FiShield,
    },
    {
      label: "Live Sessions",
      value: `${sessionCount}`,
      note: failedLoginCount ? `${failedLoginCount} failed sign-ins in 7 days` : "No failed sign-ins recorded",
      icon: FiActivity,
    },
    {
      label: "Last Sign-In",
      value: user.oversight?.lastLoginAt ? "Recorded" : "Waiting",
      note: formatTimestamp(user.oversight?.lastLoginAt),
      icon: FiClock,
    },
  ];

  const advisoryItems = [
    ...(user?.status !== "Active"
      ? [
          {
            title: "Approval still matters",
            note: "This staff record still needs an active access posture before it should be relied on live.",
          },
        ]
      : []),
    ...(user?.pinStatus !== "Assigned"
      ? [
          {
            title: "PIN still needs issuing",
            note: "The profile is visible, but the temporary access code has not been assigned yet.",
          },
        ]
      : []),
    ...(failedLoginCount > 0
      ? [
          {
            title: "Review failed sign-ins",
            note: `${failedLoginCount} failed sign-in attempts were recorded recently.`,
          },
        ]
      : []),
  ];

  if (!advisoryItems.length) {
    advisoryItems.push({
      title: "This record looks stable",
      note: "No immediate access or sign-in issues are visible from the current profile snapshot.",
    });
  }

  const activityItems = [
    {
      label: "Last sign-in",
      value: formatTimestamp(user.oversight?.lastLoginAt),
      note: user.oversight?.lastLoginAt ? "Pulled from the live workspace audit trail." : "This staff record has not signed in yet.",
    },
    {
      label: "Last sign-out",
      value: formatTimestamp(user.oversight?.lastLogoutAt),
      note: user.oversight?.lastLogoutAt ? "Most recent sign-out recorded." : "No completed sign-out recorded yet.",
    },
    {
      label: "Failed sign-ins",
      value: `${failedLoginCount} in 7 days`,
      note: failedLoginCount ? "Review before broadening access or ignoring risk notes." : "No failed sign-ins were recorded in the last week.",
    },
  ];

  return (
    <div className="staff-casebook-backdrop" onClick={onClose}>
      <div className="staff-casebook-modal" onClick={(event) => event.stopPropagation()}>
        <header className="staff-casebook-modal-header">
          <div className="staff-casebook-modal-copy">
            <span className="reference-page-kicker">User Management</span>
            <h3>Staff Casebook</h3>
            <p>
              Keep coaching notes, incident flags, and access context in one calmer user-management surface for{" "}
              {user.fullName}.
            </p>
          </div>
          <button type="button" className="staff-casebook-close" onClick={onClose} aria-label="Close casebook">
            <FiX />
          </button>
        </header>

        <section className="staff-casebook-identity">
          <div className="staff-casebook-avatar" data-tone={getIdentityTone(user.fullName, "purple")}>
            {getIdentityInitials(user.fullName, "ST")}
          </div>
          <div className="staff-casebook-identity-copy">
            <strong>{user.fullName}</strong>
            <small>
              {user.role || "Staff member"} / {user.department || "No department"}
            </small>
            <div className="staff-casebook-identity-meta">
              <span>{user.staffId || "Pending staff ID"}</span>
              <span>{user.email || "No email on file"}</span>
            </div>
          </div>
          <div className="staff-casebook-pills">
            <span className={`status-pill small ${getStatusTone(user.status)}`}>{user.status || "Pending Approval"}</span>
            <span className={`status-pill small ${getFlagTone(draft.incidentFlag)}`}>{draft.incidentFlag || "Clear"}</span>
          </div>
        </section>

        <section className="staff-casebook-summary-grid">
          {summaryCards.map((card) => (
            <article key={card.label} className="staff-casebook-summary-card">
              <div className="staff-casebook-summary-icon">
                <card.icon />
              </div>
              <span>{card.label}</span>
              <strong>{card.value}</strong>
              <small>{card.note}</small>
            </article>
          ))}
        </section>

        <nav className="staff-casebook-tabs" aria-label="Casebook sections">
          {panelTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={activePanel === tab.id ? "staff-casebook-tab is-active" : "staff-casebook-tab"}
              onClick={() => setActivePanel(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="staff-casebook-layout">
          <div className="staff-casebook-main">
            {activePanel === "casebook" ? (
              <section className="staff-casebook-surface">
                <div className="staff-casebook-surface-head">
                  <div>
                    <span className="reference-page-kicker">Casebook Notes</span>
                    <h4>Incident and coaching context</h4>
                  </div>
                  <span className="status-pill small success">
                    <FiFileText />
                    Saved with profile
                  </span>
                </div>

                <div className="stack-form staff-casebook-form">
                  <label className="users-control-label">
                    <span>Incident Flag</span>
                    <select className="input" value={draft.incidentFlag} onChange={(event) => onChange("incidentFlag", event.target.value)}>
                      {incidentFlags.map((flag) => (
                        <option key={flag} value={flag}>
                          {flag}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="users-control-label">
                    <span>Incident Note</span>
                    <input
                      className="input"
                      placeholder="Short incident summary"
                      value={draft.incidentNote}
                      onChange={(event) => onChange("incidentNote", event.target.value.slice(0, 280))}
                    />
                  </label>

                  <label className="users-control-label">
                    <span>Coaching / Staff Notes</span>
                    <textarea
                      className="input textarea"
                      placeholder="Coaching notes, strengths, access cautions, or operational context"
                      value={draft.staffNotes}
                      onChange={(event) => onChange("staffNotes", event.target.value.slice(0, 280))}
                    />
                  </label>
                </div>
              </section>
            ) : null}

            {activePanel === "access" ? (
              <section className="staff-casebook-surface">
                <div className="staff-casebook-surface-head">
                  <div>
                    <span className="reference-page-kicker">Access Snapshot</span>
                    <h4>How this staff record is currently positioned</h4>
                  </div>
                </div>

                <div className="staff-casebook-access-list">
                  <article className="staff-casebook-access-item">
                    <span>Account State</span>
                    <strong>{user.status || "Pending Approval"}</strong>
                    <small>{user.status === "Active" ? "This record is allowed into the live workspace." : "Review approval and activation before using this account live."}</small>
                  </article>
                  <article className="staff-casebook-access-item">
                    <span>PIN Posture</span>
                    <strong>{user.pinStatus || "Not Set"}</strong>
                    <small>{user.pinStatus === "Assigned" ? "A temporary access code is already active." : "A temporary PIN still needs to be assigned."}</small>
                  </article>
                  <article className="staff-casebook-access-item">
                    <span>Shift Assignment</span>
                    <strong>{draft.shiftAssignment || user.shiftAssignment || "Flexible"}</strong>
                    <small>Weekly schedule control still stays in the main staff desk.</small>
                  </article>
                </div>
              </section>
            ) : null}

            {activePanel === "activity" ? (
              <section className="staff-casebook-surface">
                <div className="staff-casebook-surface-head">
                  <div>
                    <span className="reference-page-kicker">Activity Snapshot</span>
                    <h4>Recent sign-in and session signals</h4>
                  </div>
                </div>

                <div className="staff-casebook-activity-list">
                  {activityItems.map((item) => (
                    <article key={item.label} className="staff-casebook-activity-item">
                      <div>
                        <strong>{item.label}</strong>
                        <small>{item.note}</small>
                      </div>
                      <span>{item.value}</span>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          <aside className="staff-casebook-side">
            <article className="staff-casebook-side-card">
              <div className="staff-casebook-side-head">
                <FiShield />
                <strong>Advisories</strong>
              </div>
              <div className="staff-casebook-advisory-list">
                {advisoryItems.map((item) => (
                  <div key={item.title} className="staff-casebook-advisory-item">
                    <strong>{item.title}</strong>
                    <small>{item.note}</small>
                  </div>
                ))}
              </div>
            </article>

            <article className="staff-casebook-side-card">
              <div className="staff-casebook-side-head">
                <FiClock />
                <strong>Quick Facts</strong>
              </div>
              <div className="staff-casebook-facts">
                <div>
                  <span>Last Sign-In</span>
                  <strong>{formatTimestamp(user.oversight?.lastLoginAt)}</strong>
                </div>
                <div>
                  <span>Last Sign-Out</span>
                  <strong>{formatTimestamp(user.oversight?.lastLogoutAt)}</strong>
                </div>
                <div>
                  <span>Live Sessions</span>
                  <strong>{sessionCount}</strong>
                </div>
              </div>
            </article>
          </aside>
        </div>

        <div className="form-actions staff-casebook-actions">
          <button type="button" className="btn btn-primary" disabled={saving} onClick={onSave}>
            {saving ? "Saving..." : "Save Casebook"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default StaffCasebookModal;
