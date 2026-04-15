import { startTransition, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  FaBriefcase as FiBriefcase,
  FaChartLine as FiActivity,
  FaMagnifyingGlass as FiSearch,
  FaPlus as FiPlus,
  FaShieldHalved as FiShield,
  FaUser as FiUser,
  FaUserShield as FiUserCheck,
  FaUsers as FiUsers,
} from "react-icons/fa6";

import API from "../../api/api";
import SoftPagination from "./shared/SoftPagination";
import { ANALYTICAL_BLUE_DEEP, ANALYTICAL_BLUE_MID } from "./shared/chartTheme";
import { getIdentityInitials, getIdentityTone } from "./shared/identityAvatar";
import { formatDate, getResponseData, toArray, toNumber } from "./shared/dataHelpers";

const DIRECTORY_PAGE_SIZE = 8;

function getStatusTone(status = "") {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("active")) return "success";
  if (normalized.includes("pending")) return "warning";
  if (normalized.includes("inactive") || normalized.includes("suspend")) return "danger";
  return "neutral";
}

function Users({ currentUser }) {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState("users-directory-board");
  const [roleFilter, setRoleFilter] = useState("All");
  const [departmentFilter, setDepartmentFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [updatingUserId, setUpdatingUserId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [directoryPage, setDirectoryPage] = useState(1);

  const isOwner = String(currentUser?.role || "") === "Owner";

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const response = await API.get("/users");
        if (cancelled) return;

        startTransition(() => {
          setUsers(toArray(getResponseData(response)));
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) setError(requestError?.message || "Could not load users.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [refreshNonce]);

  useEffect(() => {
    setDirectoryPage(1);
  }, [query, roleFilter, departmentFilter, statusFilter, users.length]);

  const filteredUsers = useMemo(() => {
    const term = String(query || "").trim().toLowerCase();

    return users.filter((user) => {
      if (roleFilter !== "All" && String(user?.role || "") !== roleFilter) return false;
      if (departmentFilter !== "All" && String(user?.department || "") !== departmentFilter) return false;
      if (statusFilter !== "All" && String(user?.status || "") !== statusFilter) return false;
      if (!term) return true;

      return [user?.fullName, user?.staffId, user?.email, user?.department].some((field) =>
        String(field || "")
          .toLowerCase()
          .includes(term)
      );
    });
  }, [users, query, roleFilter, departmentFilter, statusFilter]);

  const departmentOptions = useMemo(
    () =>
      Array.from(
        new Set(
          users
            .map((user) => String(user?.department || "").trim())
            .filter(Boolean)
        )
      ).sort((left, right) => left.localeCompare(right)),
    [users]
  );

  const roleCounts = useMemo(() => {
    const counts = {
      owners: 0,
      managers: 0,
      cashiers: 0,
      inventory: 0,
    };

    users.forEach((user) => {
      const role = String(user?.role || "");
      if (role === "Owner") counts.owners += 1;
      if (role === "Manager") counts.managers += 1;
      if (role === "Cashier") counts.cashiers += 1;
      if (role === "Inventory Clerk") counts.inventory += 1;
    });

    return counts;
  }, [users]);

  const activeCount = users.filter((user) => String(user?.status || "") === "Active").length;
  const pendingCount = users.filter((user) => String(user?.status || "") === "Pending Approval").length;
  const sessionCount = users.reduce((sum, user) => sum + toNumber(user?.oversight?.activeSessionCount), 0);
  const failedLogins = users.reduce((sum, user) => sum + toNumber(user?.oversight?.failedLoginCount7d), 0);

  const sessionWatch = useMemo(
    () =>
      users
        .filter(
          (user) =>
            toNumber(user?.oversight?.activeSessionCount) > 0 ||
            toNumber(user?.oversight?.failedLoginCount7d) > 0
        )
        .sort(
          (left, right) =>
            toNumber(right?.oversight?.failedLoginCount7d) - toNumber(left?.oversight?.failedLoginCount7d) ||
            toNumber(right?.oversight?.activeSessionCount) - toNumber(left?.oversight?.activeSessionCount)
        )
        .slice(0, 6),
    [users]
  );

  const roleChartData = [
    { label: "Owners", value: roleCounts.owners },
    { label: "Managers", value: roleCounts.managers },
    { label: "Cashiers", value: roleCounts.cashiers },
    { label: "Inventory", value: roleCounts.inventory },
  ];

  const summaryCards = [
    { label: "All Users", value: `${users.length}`, note: `${activeCount} active`, icon: FiUsers },
    { label: "Admins", value: `${roleCounts.owners + roleCounts.managers}`, note: "Owner and manager access", icon: FiShield },
    { label: "Inventory Managers", value: `${roleCounts.inventory}`, note: "Inventory-led staff records", icon: FiUser },
    { label: "Sales Managers", value: `${roleCounts.cashiers}`, note: `${pendingCount} pending approval`, icon: FiUser },
  ];

  const managementTabs = [
    { label: "Workforce Directory", target: "users-directory-board" },
    { label: "Roles & Access", target: "users-roles-board" },
    { label: "Sessions", target: "users-session-board" },
    { label: "Invitations", target: "users-tools-board" },
    { label: "Notifications", target: "users-tools-board" },
  ];

  const quickTools = [
    {
      key: "invite",
      label: "Invite Workspace User",
      note: "Create the next staff record with role and approval defaults.",
      icon: FiPlus,
      actionLabel: "Invite User",
      onClick: () => {},
      href: "/users/staff/new",
    },
    {
      key: "pending",
      label: "Approval Queue",
      note: `${pendingCount} staff records are waiting for activation review.`,
      icon: FiUserCheck,
      actionLabel: "Review Pending",
      onClick: () => {
        setStatusFilter("Pending Approval");
        document.getElementById("users-directory-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    },
    {
      key: "sessions",
      label: "Session Watch",
      note: `${sessionCount} live sessions / ${failedLogins} failed sign-ins need visibility.`,
      icon: FiActivity,
      actionLabel: "Open Watch",
      onClick: () => {
        document.getElementById("users-session-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    },
    {
      key: "roles",
      label: "Role Controls",
      note: `${roleCounts.owners + roleCounts.managers} elevated accounts across the workspace.`,
      icon: FiBriefcase,
      actionLabel: "View Roles",
      onClick: () => {
        document.getElementById("users-roles-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    },
  ];

  const directoryTotalPages = Math.max(1, Math.ceil(filteredUsers.length / DIRECTORY_PAGE_SIZE));
  const activeDirectoryPage = Math.min(directoryPage, directoryTotalPages);
  const directoryRows = filteredUsers.slice(
    (activeDirectoryPage - 1) * DIRECTORY_PAGE_SIZE,
    activeDirectoryPage * DIRECTORY_PAGE_SIZE
  );

  const updateStatus = async (user, status) => {
    if (!user?.id || !isOwner || updatingUserId) return;
    if (String(user?.id) === String(currentUser?.id) && status !== "Active") return;

    try {
      setUpdatingUserId(String(user.id));
      setError("");
      setNotice("");
      await API.patch(`/users/${user.id}/status`, { status });
      setNotice(`${user.fullName} set to ${status}.`);
      setRefreshNonce((value) => value + 1);
    } catch (requestError) {
      setError(requestError?.message || "Could not update user status.");
    } finally {
      setUpdatingUserId("");
    }
  };

  return (
    <div className="page-container users-ref-page users-management-overview-page">
      {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}
      {notice ? <div className="info-banner">{notice}</div> : null}

      <section className="reference-page-heading users-reference-heading">
        <div className="reference-page-heading-copy">
          <span className="reference-page-kicker">Workforce Control</span>
          <h1>User Management</h1>
          <p>Manage your team members, their roles, approval state, and store access in one calmer workforce surface.</p>
        </div>

        <div className="reference-page-heading-actions">
          <Link to="/users/staff/new" className="btn btn-primary">
            <FiPlus />
            Invite User
          </Link>
        </div>
      </section>

      <section className="users-management-tabs" aria-label="User management sections">
        {managementTabs.map((tab, index) => (
          <button
            key={tab.label}
            type="button"
            className={activeTab === tab.target || (index === 0 && activeTab === "users-directory-board") ? "users-management-tab is-active" : "users-management-tab"}
            onClick={() => {
              setActiveTab(tab.target);
              document.getElementById(tab.target)?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            {tab.label}
          </button>
        ))}
      </section>

      <section className="soft-summary-grid soft-summary-grid--four users-management-stats">
        {summaryCards.map((card) => (
          <article key={card.label} className="soft-summary-card">
            <div className="soft-summary-icon">{card.icon ? <card.icon /> : null}</div>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>

      <section className="users-management-command-row">
        <div className="reference-inline-search users-management-search">
          <FiSearch />
          <input
            className="input soft-table-search"
            type="text"
            placeholder="Search profiles, emails, or usernames"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Link to="/users/staff/new" className="btn btn-primary">
          <FiPlus />
          Invite User
        </Link>
      </section>

      <section id="users-directory-board" className="soft-panel soft-table-card users-directory-card">
        <header className="soft-panel-header">
          <div>
            <span className="reference-page-kicker">User directory</span>
            <h2>Live roster</h2>
          </div>
        </header>

        <div className="soft-table-toolbar soft-table-toolbar--filters users-directory-toolbar">
          <span className="users-directory-count">{filteredUsers.length} items</span>
          <select className="input" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="All">All roles</option>
            <option value="Owner">Owner</option>
            <option value="Manager">Manager</option>
            <option value="Cashier">Cashier</option>
            <option value="Inventory Clerk">Inventory Clerk</option>
          </select>
          <select className="input" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
            <option value="All">All departments</option>
            {departmentOptions.map((department) => (
              <option key={department} value={department}>
                {department}
              </option>
            ))}
          </select>
          <select className="input" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="All">All statuses</option>
            <option value="Active">Active</option>
            <option value="Pending Approval">Pending Approval</option>
            <option value="Inactive">Inactive</option>
          </select>
          {(query || roleFilter !== "All" || departmentFilter !== "All" || statusFilter !== "All") ? (
            <button
              type="button"
              className="btn btn-secondary btn-compact"
              onClick={() => {
                setQuery("");
                setRoleFilter("All");
                setDepartmentFilter("All");
                setStatusFilter("All");
              }}
            >
              Clear
            </button>
          ) : null}
        </div>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Department</th>
                <th>Last Active</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    Loading staff records...
                  </td>
                </tr>
              ) : directoryRows.length ? (
                directoryRows.map((user) => (
                  <tr key={user?.id}>
                    <td>
                      <div className="reference-name-cell">
                        <span
                          className="reference-avatar reference-avatar--user"
                          data-tone={getIdentityTone(user?.fullName, "cyan")}
                        >
                          {getIdentityInitials(user?.fullName, "US")}
                        </span>
                        <div>
                          <strong>{user?.fullName || "Unnamed user"}</strong>
                          <div>{user?.staffId || "No staff id"}</div>
                        </div>
                      </div>
                    </td>
                    <td>{user?.email || "n/a"}</td>
                    <td>
                      <div className="users-role-cell">
                        <strong>{user?.role || "Unknown"}</strong>
                        <small>{user?.staffId || "No staff id"}</small>
                      </div>
                    </td>
                    <td>{user?.department || "Unassigned"}</td>
                    <td>{formatDate(user?.oversight?.lastLoginAt)}</td>
                    <td>
                      <span className={`status-pill small ${getStatusTone(user?.status)}`}>{user?.status || "Unknown"}</span>
                    </td>
                    <td>
                      <div className="soft-table-actions users-table-actions">
                        <Link className="btn btn-secondary btn-compact" to={`/users/staff/${user?.id}`}>
                          View
                        </Link>
                        {isOwner ? (
                          <select
                            className="input soft-table-select"
                            value={user?.status || "Pending Approval"}
                            onChange={(event) => updateStatus(user, event.target.value)}
                            disabled={updatingUserId === String(user?.id)}
                          >
                            <option value="Pending Approval">Pending Approval</option>
                            <option value="Active">Active</option>
                            <option value="Inactive">Inactive</option>
                          </select>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="empty-cell">
                    No staff records match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <SoftPagination currentPage={activeDirectoryPage} totalPages={directoryTotalPages} onChange={setDirectoryPage} />
      </section>

      <section className="soft-section-grid soft-section-grid--two users-reference-lower">
        <article id="users-roles-board" className="soft-panel">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Role mix</span>
              <h2>Current workforce composition</h2>
            </div>
          </header>
          <div className="soft-chart-shell soft-chart-shell--short">
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={roleChartData}>
                <defs>
                  <linearGradient id="usersRoleBarFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={ANALYTICAL_BLUE_MID} />
                    <stop offset="100%" stopColor={ANALYTICAL_BLUE_DEEP} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px" }} />
                <Bar dataKey="value" fill="url(#usersRoleBarFill)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article id="users-session-board" className="soft-panel">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Session watch</span>
              <h2>Who deserves review</h2>
            </div>
          </header>
          <div className="soft-list">
            {sessionWatch.length ? (
              sessionWatch.map((user, index) => (
                <article key={`${user?.id || "user"}-${index}`} className="soft-list-row">
                  <div className="reference-name-cell reference-name-cell--compact">
                    <span
                      className="reference-avatar reference-avatar--user"
                      data-tone={getIdentityTone(user?.fullName, "cyan")}
                    >
                      {getIdentityInitials(user?.fullName, "US")}
                    </span>
                    <div>
                      <strong>{user?.fullName || "Staff member"}</strong>
                      <small>
                        {user?.role || "Unknown role"} / {user?.department || "Unknown department"}
                      </small>
                    </div>
                  </div>
                  <div className="soft-inline-value">
                    <strong>{toNumber(user?.oversight?.activeSessionCount)} live</strong>
                    <small>{toNumber(user?.oversight?.failedLoginCount7d)} failed / 7d</small>
                  </div>
                </article>
              ))
            ) : (
              <p className="subtle">No session or login-hygiene watch items are active right now.</p>
            )}
          </div>
        </article>
      </section>

      <section id="users-tools-board" className="soft-panel soft-panel--compact users-tools-board">
        <header className="soft-panel-header">
          <div>
            <span className="reference-page-kicker">Workforce tools</span>
            <h2>Actions related to users and access</h2>
          </div>
          <span className={`status-pill small ${failedLogins > 0 ? "warning" : "success"}`}>
            {failedLogins} recent failed sign-ins
          </span>
        </header>
        <div className="soft-card-grid soft-card-grid--four users-tool-grid">
          {quickTools.map((tool) => (
            <article key={tool.key} className="soft-panel soft-panel--compact users-tool-card">
              <div className="users-tool-icon">
                <tool.icon />
              </div>
              <div className="users-tool-copy">
                <strong>{tool.label}</strong>
                <small>{tool.note}</small>
              </div>
              {tool.href ? (
                <Link className="btn btn-secondary btn-compact" to={tool.href}>
                  {tool.actionLabel}
                </Link>
              ) : (
                <button type="button" className="btn btn-secondary btn-compact" onClick={tool.onClick}>
                  {tool.actionLabel}
                </button>
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export default Users;
