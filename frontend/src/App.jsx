import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  NavLink,
  Navigate,
  useLocation,
  useNavigate,
} from "react-router-dom";
import {
  FaArrowRightFromBracket as FiLogOut,
  FaBars as FiMenu,
  FaBell as FiBell,
  FaBoxArchive as FiBox,
  FaCartShopping as FiShoppingCart,
  FaChartColumn as FiBarChart2,
  FaDisplay as FiMonitor,
  FaGear as FiSettings,
  FaLocationDot as FiMapPin,
  FaMagnifyingGlass as FiSearch,
  FaTableCellsLarge as FiHome,
  FaTruckFast as FiTruck,
  FaUser as FiUser,
  FaUsers as FiUsers,
  FaUserShield as FiUserCheck,
  FaXmark as FiX,
} from "react-icons/fa6";

import API from "./api/api";
import { canAccessRoute, getDefaultRoute, getRouteMeta, getVisibleNavItems } from "./config/access";
import defaultSettings from "./config/defaultSettings";
import useWorkspaceSettings from "./hooks/useWorkspaceSettings";
import {
  clearAuthSession,
  hasAuthSession,
  readStoredUser as readStoredSessionUser,
  writeAuthSession,
} from "./utils/sessionStore";
import GlobalCommandPalette from "./components/GlobalCommandPalette.jsx";
import { getIdentityTone } from "./components/pages/shared/identityAvatar.js";
import "./components/pages/global.css";
import "./components/pages/reference-surfaces.css";

const Login = lazy(() => import("./components/pages/Login.jsx"));
const Dashboard = lazy(() => import("./components/pages/Dashboard.jsx"));
const POSDashboard = lazy(() => import("./components/pages/POSDashboard.jsx"));
const POS = lazy(() => import("./components/pages/POS.jsx"));
const Users = lazy(() => import("./components/pages/Users.jsx"));
const UserManagementDesk = lazy(() => import("./components/pages/UserManagementDesk.jsx"));
const Reports = lazy(() => import("./components/pages/Reports.jsx"));
const Settings = lazy(() => import("./components/pages/Settings.jsx"));
const Orders = lazy(() => import("./components/pages/Orders.jsx"));
const Customers = lazy(() => import("./components/pages/Customers.jsx"));
const CustomerProfile = lazy(() => import("./components/pages/CustomerProfile.jsx"));
const Suppliers = lazy(() => import("./components/pages/Suppliers.jsx"));
const NotFound = lazy(() => import("./components/pages/NotFound.jsx"));
const OwnerAssistantDock = lazy(() => import("./components/OwnerAssistantDock.jsx"));

const NAV_ICONS = {
  "/": FiHome,
  "/pos-dashboard": FiBox,
  "/terminal": FiMonitor,
  "/orders": FiShoppingCart,
  "/reports": FiBarChart2,
  "/customers": FiUsers,
  "/suppliers": FiTruck,
  "/users": FiUserCheck,
  "/settings": FiSettings,
};

const SIDEBAR_ICON_STYLES = {
  dashboard: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(37, 99, 235, 0.24)",
    background: "linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)",
    color: "#ffffff",
  },
  inventory: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(99, 102, 241, 0.24)",
    background: "linear-gradient(135deg, #7c3aed 0%, #6366f1 100%)",
    color: "#ffffff",
  },
  pos: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(14, 165, 233, 0.24)",
    background: "linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)",
    color: "#ffffff",
  },
  orders: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #f59e0b 0%, #fb7185 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(249, 115, 22, 0.24)",
    background: "linear-gradient(135deg, #f59e0b 0%, #fb7185 100%)",
    color: "#ffffff",
  },
  reports: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(99, 102, 241, 0.24)",
    background: "linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%)",
    color: "#ffffff",
  },
  customers: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(56, 189, 248, 0.24)",
    background: "linear-gradient(135deg, #38bdf8 0%, #2563eb 100%)",
    color: "#ffffff",
  },
  suppliers: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #f97316 0%, #f59e0b 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(249, 115, 22, 0.24)",
    background: "linear-gradient(135deg, #f97316 0%, #f59e0b 100%)",
    color: "#ffffff",
  },
  users: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(168, 85, 247, 0.24)",
    background: "linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)",
    color: "#ffffff",
  },
  settings: {
    "--sidebar-icon-gradient": "linear-gradient(135deg, #2563eb 0%, #8b5cf6 100%)",
    "--sidebar-icon-shadow": "0 12px 24px rgba(59, 130, 246, 0.24)",
    background: "linear-gradient(135deg, #2563eb 0%, #8b5cf6 100%)",
    color: "#ffffff",
  },
};

const WELCOME_AVATAR_STYLES = {
  violet: {
    "--welcome-avatar-gradient": "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
    "--welcome-avatar-shadow": "0 14px 30px rgba(124, 58, 237, 0.26)",
    background: "linear-gradient(135deg, #7c3aed 0%, #a855f7 100%)",
    color: "#ffffff",
  },
  purple: {
    "--welcome-avatar-gradient": "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
    "--welcome-avatar-shadow": "0 14px 30px rgba(99, 102, 241, 0.24)",
    background: "linear-gradient(135deg, #8b5cf6 0%, #6366f1 100%)",
    color: "#ffffff",
  },
  blue: {
    "--welcome-avatar-gradient": "linear-gradient(135deg, #2563eb 0%, #60a5fa 100%)",
    "--welcome-avatar-shadow": "0 14px 30px rgba(37, 99, 235, 0.24)",
    background: "linear-gradient(135deg, #2563eb 0%, #60a5fa 100%)",
    color: "#ffffff",
  },
  cyan: {
    "--welcome-avatar-gradient": "linear-gradient(135deg, #06b6d4 0%, #38bdf8 100%)",
    "--welcome-avatar-shadow": "0 14px 30px rgba(14, 165, 233, 0.24)",
    background: "linear-gradient(135deg, #06b6d4 0%, #38bdf8 100%)",
    color: "#ffffff",
  },
  pink: {
    "--welcome-avatar-gradient": "linear-gradient(135deg, #ec4899 0%, #f97316 100%)",
    "--welcome-avatar-shadow": "0 14px 30px rgba(236, 72, 153, 0.24)",
    background: "linear-gradient(135deg, #ec4899 0%, #f97316 100%)",
    color: "#ffffff",
  },
};

const RECENT_ROUTE_STORAGE_KEY = "afrospice_recent_routes";

function readRecentRoutes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_ROUTE_STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function writeRecentRoutes(paths) {
  try {
    localStorage.setItem(RECENT_ROUTE_STORAGE_KEY, JSON.stringify(paths.slice(0, 6)));
  } catch {
    // Keep the shell resilient if storage is blocked.
  }
}

function rememberRoute(path) {
  if (!path || path === "/login") return;
  const next = [path, ...readRecentRoutes().filter((entry) => entry !== path)].slice(0, 6);
  writeRecentRoutes(next);
}

function resolveRouteTheme(pathname) {
  if (pathname === "/") return "dashboard";
  if (pathname.startsWith("/pos-dashboard")) return "inventory";
  if (pathname.startsWith("/terminal")) return "pos";
  if (pathname.startsWith("/orders")) return "orders";
  if (pathname.startsWith("/reports")) return "reports";
  if (pathname.startsWith("/customers")) return "customers";
  if (pathname.startsWith("/suppliers")) return "suppliers";
  if (pathname.startsWith("/users")) return "users";
  if (pathname.startsWith("/settings")) return "settings";
  return "dashboard";
}

function groupNavItems(items = []) {
  const groups = [
    {
      label: "Main",
      paths: ["/", "/pos-dashboard", "/terminal", "/orders"],
    },
    {
      label: "Analytics",
      paths: ["/reports", "/customers", "/suppliers", "/users"],
    },
    {
      label: "Settings",
      paths: ["/settings"],
    },
  ];

  return groups
    .map((group) => ({
      ...group,
      items: items.filter((item) => group.paths.includes(item.path)),
    }))
    .filter((group) => group.items.length);
}

function RouteLoader() {
  return (
    <div className="app-boot-shell">
      <div className="app-boot-mark">AfroSpice</div>
      <p>Loading workspace...</p>
    </div>
  );
}

function ProtectedRoute({ loggedIn, sessionReady, userRole, allowedRoles, children }) {
  if (!loggedIn) {
    return <Navigate to="/login" replace />;
  }

  if (!sessionReady) {
    return <div className="app-boot-shell">Loading workspace session...</div>;
  }

  if (allowedRoles?.length && !canAccessRoute(userRole, allowedRoles)) {
    return <Navigate to={getDefaultRoute(userRole)} replace />;
  }

  return children;
}

function OwnerMenu({ settings, sessionUser, onLogout, profileTone }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const menuRef = useRef(null);

  useEffect(() => {
    const handleOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const displayName = sessionUser?.fullName || settings.managerName || "Workspace User";
  const displayRole = sessionUser?.role || "Owner";
  const initials = displayName
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="owner-menu" ref={menuRef}>
      <button
        type="button"
        className="owner-avatar-btn"
        onClick={() => setOpen((previous) => !previous)}
      >
        <span className="owner-avatar-circle" data-tone={profileTone}>
          {initials}
        </span>
        <span className="owner-avatar-meta">
          <strong>{displayName}</strong>
          <small>{displayRole}</small>
        </span>
      </button>

      {open ? (
        <div className="owner-menu-dropdown">
          <div className="owner-menu-header">
            <div className="owner-menu-avatar" data-tone={profileTone}>
              {initials}
            </div>
            <div>
              <strong>{displayName}</strong>
              <p>{settings.storeName}</p>
            </div>
          </div>

          {getVisibleNavItems(displayRole).slice(1).map((item) => (
            <button
              key={item.path}
              type="button"
              className="owner-menu-item"
              onClick={() => {
                navigate(item.path);
                setOpen(false);
              }}
            >
              {item.label}
            </button>
          ))}

          <button
            type="button"
            className="owner-menu-item danger"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
          >
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}

function ForcePinChangeModal({ sessionUser, onUserUpdate, onLogout }) {
  const [form, setForm] = useState({
    currentPin: "",
    nextPin: "",
    confirmPin: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const updateField = (field, value) => {
    setForm((previous) => ({
      ...previous,
      [field]: String(value || "").replace(/\D/g, "").slice(0, 6),
    }));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!/^\d{4,6}$/.test(form.currentPin) || !/^\d{4,6}$/.test(form.nextPin)) {
      setError("Current PIN and new PIN must both use 4-6 digits.");
      return;
    }

    if (form.nextPin !== form.confirmPin) {
      setError("PIN confirmation does not match.");
      return;
    }

    if (form.currentPin === form.nextPin) {
      setError("Choose a new PIN that is different from the temporary PIN.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      const res = await API.post("/auth/change-pin", form);
      const nextUser = res?.data?.data?.user || null;
      if (nextUser) {
        onUserUpdate(nextUser);
      }
    } catch (submitError) {
      console.error("Forced PIN change failed:", submitError);
      setError(submitError?.message || submitError?.data?.message || "Failed to change PIN.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="force-pin-modal-backdrop">
      <div className="force-pin-modal">
        <div className="force-pin-modal-copy">
          <p className="eyebrow">Security Update</p>
          <h3>Change Your Temporary PIN</h3>
          <p>
            {sessionUser?.fullName || "This staff account"} must replace the temporary PIN before using the workspace.
          </p>
        </div>

        {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}

        <form className="stack-form" onSubmit={handleSubmit}>
          <input
            className="input"
            type="password"
            inputMode="numeric"
            placeholder="Current temporary PIN"
            value={form.currentPin}
            onChange={(event) => updateField("currentPin", event.target.value)}
          />
          <div className="form-two-col">
            <input
              className="input"
              type="password"
              inputMode="numeric"
              placeholder="New PIN"
              value={form.nextPin}
              onChange={(event) => updateField("nextPin", event.target.value)}
            />
            <input
              className="input"
              type="password"
              inputMode="numeric"
              placeholder="Confirm new PIN"
              value={form.confirmPin}
              onChange={(event) => updateField("confirmPin", event.target.value)}
            />
          </div>

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Saving..." : "Save New PIN"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={onLogout} disabled={saving}>
              Logout
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function AppShell({ settings, sessionUser, onLogout, onUserUpdate, children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationPayload, setNotificationPayload] = useState({
    generatedAt: null,
    unreadCount: 0,
    items: [],
  });
  const notificationRef = useRef(null);
  const routeMeta = useMemo(() => getRouteMeta(location.pathname), [location.pathname]);
  const routeTheme = useMemo(() => resolveRouteTheme(location.pathname), [location.pathname]);
  const navItems = useMemo(() => getVisibleNavItems(sessionUser?.role), [sessionUser?.role]);
  const navGroups = useMemo(() => groupNavItems(navItems), [navItems]);
  const profileInitials = useMemo(() => {
    const source = String(sessionUser?.fullName || settings.managerName || "AfroSpice")
      .split(" ")
      .filter(Boolean)
      .map((part) => part[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

    return source || "AS";
  }, [sessionUser?.fullName, settings.managerName]);
  const sidebarStoreLabel = useMemo(() => {
    const storeName = String(settings.storeName || "Main Branch").trim();
    return storeName.replace(/^AfroSpice\s+/i, "") || storeName;
  }, [settings.storeName]);
  const profileTone = useMemo(
    () => getIdentityTone(sessionUser?.fullName || settings.managerName || settings.storeName || "Store Owner", "blue"),
    [sessionUser?.fullName, settings.managerName, settings.storeName]
  );
  const ownerAvatarStyle = useMemo(
    () => WELCOME_AVATAR_STYLES[profileTone] || WELCOME_AVATAR_STYLES.blue,
    [profileTone]
  );
  const searchPrompt = useMemo(
    () => `Search ${String(routeMeta.label || "workspace").toLowerCase()}, actions, and tools`,
    [routeMeta.label]
  );

  const loadNotifications = useCallback(async () => {
    try {
      setNotificationsLoading(true);
      setNotificationsError("");
      const response = await API.get("/reports/notifications");
      const payload = response?.data?.data || response?.data || {};
      setNotificationPayload({
        generatedAt: payload?.generatedAt || null,
        unreadCount: Number(payload?.unreadCount || 0),
        items: Array.isArray(payload?.items) ? payload.items : [],
      });
    } catch (error) {
      console.error("Failed to load notifications:", error);
      setNotificationsError(error?.message || "Unable to load workspace notifications.");
      setNotificationPayload((previous) => ({
        ...previous,
        unreadCount: previous?.items?.length || 0,
      }));
    } finally {
      setNotificationsLoading(false);
    }
  }, []);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandPaletteOpen(true);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    loadNotifications();
  }, [loadNotifications, location.pathname]);

  useEffect(() => {
    const handleOutside = (event) => {
      if (notificationRef.current && !notificationRef.current.contains(event.target)) {
        setNotificationOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  const handleNavigate = useCallback(
    (path) => {
      rememberRoute(path);
      setCommandPaletteOpen(false);
      setCommandQuery("");
      setNotificationOpen(false);
      setSidebarOpen(false);
      navigate(path);
    },
    [navigate]
  );

  const commandPaletteItems = useMemo(() => {
    const routeItems = navItems.map((item) => ({
      id: `route:${item.path}`,
      title: item.label,
      eyebrow: item.eyebrow,
      description: item.description,
      meta: item.path === location.pathname ? "Current route" : "Open workspace",
      badge: item.path === location.pathname ? "Open" : "",
      tone: item.path === location.pathname ? "active" : "",
      searchText: [item.label, item.eyebrow, item.description, item.path].join(" ").toLowerCase(),
      run: () => handleNavigate(item.path),
    }));

    const utilityItems = [
      ["Owner", "Manager"].includes(String(sessionUser?.role || ""))
        ? {
            id: "assistant",
            title: "Ask the business assistant",
            eyebrow: "Assistant",
            description: "Open the grounded owner assistant for live questions about sales, stock, suppliers, staff, and forecasting.",
            meta: "Ctrl answers",
            searchText: "assistant ai copilot owner intelligence forecast ask question",
            run: () => {
              window.dispatchEvent(new Event("afrospice:owner-ai:open"));
            },
          }
        : null,
      {
        id: "settings",
        title: "Open workspace controls",
        eyebrow: "Settings",
        description: "Go straight to operating rules, theme controls, and store configuration.",
        meta: "Preferences",
        searchText: "settings theme preferences store controls",
        run: () => handleNavigate("/settings"),
      },
      {
        id: "logout",
        title: "Sign out securely",
        eyebrow: "Session",
        description: "End the current workspace session and return to secure sign-in.",
        meta: "Logout",
        danger: true,
        searchText: "logout sign out exit session",
        run: onLogout,
      },
    ].filter(Boolean);

    return [...routeItems, ...utilityItems];
  }, [handleNavigate, location.pathname, navItems, onLogout, sessionUser?.role]);

  const filteredCommandItems = useMemo(() => {
    const term = commandQuery.trim().toLowerCase();
    if (!term) return commandPaletteItems;
    return commandPaletteItems.filter((item) => item.searchText.includes(term));
  }, [commandPaletteItems, commandQuery]);

  const recentCommandItems = useMemo(() => {
    const recentRoutes = readRecentRoutes();
    const recentSet = recentRoutes.filter((path) => path !== location.pathname);
    return recentSet
      .map((path) => navItems.find((item) => item.path === path))
      .filter(Boolean)
      .slice(0, 4)
      .map((item) => ({
        id: `recent:${item.path}`,
        title: item.label,
        eyebrow: item.eyebrow,
        description: item.description,
        meta: "Jump back in",
        recent: true,
        run: () => handleNavigate(item.path),
      }));
  }, [handleNavigate, location.pathname, navItems]);

  const handleCommandSelect = useCallback((item) => {
    setCommandPaletteOpen(false);
    setCommandQuery("");
    item?.run?.();
  }, []);

  const handleNotificationSelect = useCallback(
    (item) => {
      const action = item?.action || {};
      setNotificationOpen(false);
      rememberRoute(action.path || "/");
      navigate(action.path || "/", {
        state: {
          assistantActionLabel: action.label || item?.title || "Open workspace",
          assistantActionNote: action.note || item?.detail || "",
          assistantFocus: action.focus || "",
          assistantTs: Date.now(),
        },
      });
    },
    [navigate]
  );

  const notificationTimestamp = useMemo(() => {
    if (!notificationPayload.generatedAt) return "Live workspace alerts";
    try {
      return `Updated ${new Date(notificationPayload.generatedAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })}`;
    } catch {
      return "Live workspace alerts";
    }
  }, [notificationPayload.generatedAt]);

  return (
    <div className={sidebarOpen ? `app workspace-shell route-theme-${routeTheme} sidebar-open` : `app workspace-shell route-theme-${routeTheme}`} data-route-theme={routeTheme}>
      <div
        className={sidebarOpen ? "sidebar-backdrop visible" : "sidebar-backdrop"}
        onClick={() => setSidebarOpen(false)}
        aria-hidden={!sidebarOpen}
      />

      <aside className={sidebarOpen ? "sidebar is-open" : "sidebar"} aria-label="Workspace navigation">
        <div className="sidebar-brand">
          <div className="sidebar-brand-main">
            <div className="brand-logo" aria-hidden="true">
              <span className="brand-logo-shape brand-logo-shape-top"></span>
              <span className="brand-logo-shape brand-logo-shape-bottom"></span>
            </div>
            <div className="sidebar-brand-copy">
              <div className="sidebar-brand-head">
                <h1 className="brand-title">AfroSpice</h1>
                <span className="sidebar-brand-badge">{settings.branchCode}</span>
              </div>
              <p className="brand-subtitle">{sidebarStoreLabel}</p>
            </div>
          </div>
          <button
            type="button"
            className="sidebar-mobile-close"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close navigation"
          >
            <FiX />
          </button>
        </div>

        <div className="sidebar-welcome-card">
          <div
            className="sidebar-welcome-avatar"
            data-tone={profileTone}
            style={ownerAvatarStyle}
          >
            {profileInitials}
          </div>
          <div className="sidebar-welcome-copy">
            <span>Workspace owner</span>
            <strong>{sessionUser?.fullName?.split(" ")?.[0] || settings.managerName || "Operator"}</strong>
            <small>{`${sessionUser?.role || "Store staff"} · ${settings.branchCode}`}</small>
          </div>
        </div>

        <nav className="sidebar-nav">
          {navGroups.map((group) => (
            <div key={group.label} className="sidebar-section">
              <span className="sidebar-section-title">{group.label}</span>
              <div className="sidebar-section-links">
                {group.items.map((item) => {
                  const Icon = NAV_ICONS[item.path] || FiHome;
                  const itemMeta = getRouteMeta(item.path);
                  const routeTheme = resolveRouteTheme(item.path);

                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      end={item.path === "/"}
                      onClick={() => {
                        rememberRoute(item.path);
                        setSidebarOpen(false);
                      }}
                      className={({ isActive }) => (isActive ? "sidebar-link active" : "sidebar-link")}
                    >
                      <span
                        className={`sidebar-link-icon sidebar-link-icon--${routeTheme}`}
                        style={SIDEBAR_ICON_STYLES[routeTheme] || SIDEBAR_ICON_STYLES.dashboard}
                        aria-hidden="true"
                      >
                        <Icon />
                      </span>
                      <span className="sidebar-link-copy">
                        <strong>{item.label}</strong>
                        <small>{itemMeta.eyebrow}</small>
                      </span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-footer-card">
            <div className="sidebar-footer-card-copy">
              <strong>{settings.storeName || "AfroSpice Main Branch"}</strong>
              <small>{sessionUser?.role || "Admin"} access on the live retail workspace.</small>
            </div>
          </div>

          <div className="sidebar-footer-actions">
            <button type="button" className="sidebar-footer-action" onClick={() => navigate("/settings")}>
              <FiUser />
              <span>Account</span>
            </button>
            <button
              type="button"
              className="sidebar-footer-action"
              onClick={() => navigate(["Owner", "Manager"].includes(String(sessionUser?.role || "")) ? "/users" : getDefaultRoute(sessionUser?.role))}
            >
              <FiUserCheck />
              <span>{sessionUser?.role || "Admin"}</span>
            </button>
            <button type="button" className="sidebar-footer-action sidebar-footer-action--danger" onClick={onLogout}>
              <FiLogOut />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </aside>

      <section className="main workspace-main">
        <header className="topbar workspace-topbar">
          <div className="workspace-commandbar">
            <div className="workspace-commandbar-main">
              <button
                type="button"
                className="shell-nav-toggle"
                onClick={() => setSidebarOpen((current) => !current)}
                aria-label="Open navigation"
                aria-expanded={sidebarOpen}
              >
                <FiMenu />
              </button>

              <div className="workspace-commandbar-copy workspace-commandbar-copy--slim">
                <div className="workspace-title-stack">
                  <span className="workspace-command-chip">{routeMeta.label}</span>
                  <small>{routeMeta.description}</small>
                </div>
              </div>

              <button
                type="button"
                className="workspace-search-trigger"
                onClick={() => setCommandPaletteOpen(true)}
                aria-label="Search workspace"
              >
                <span className="workspace-search-trigger-icon">
                  <FiSearch />
                </span>
                <span className="workspace-search-trigger-copy">
                  <strong>{searchPrompt}</strong>
                </span>
                <kbd>Ctrl K</kbd>
              </button>
            </div>

            <div className="workspace-commandbar-side">
              <div className="workspace-command-tools">
                <div className="workspace-notification-shell" ref={notificationRef}>
                  <button
                    type="button"
                    className={notificationPayload.unreadCount > 0 ? "workspace-topbar-icon has-unread" : "workspace-topbar-icon"}
                    aria-label="Notifications"
                    aria-expanded={notificationOpen}
                    onClick={() => {
                      const nextOpen = !notificationOpen;
                      setNotificationOpen(nextOpen);
                      if (nextOpen) {
                        loadNotifications();
                      }
                    }}
                  >
                    <FiBell />
                  </button>

                  {notificationOpen ? (
                    <div className="workspace-notification-popover">
                      <div className="workspace-notification-header">
                        <div>
                          <h3>Notifications</h3>
                          <p>{notificationTimestamp}</p>
                        </div>
                      </div>

                      <div className="workspace-notification-list">
                        {notificationsError ? (
                          <div className="workspace-notification-empty">{notificationsError}</div>
                        ) : null}

                        {!notificationsError && !notificationsLoading && !notificationPayload.items.length ? (
                          <div className="workspace-notification-empty">No new workspace alerts right now.</div>
                        ) : null}

                        {notificationPayload.items.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className={`workspace-notification-item${item?.tone ? ` is-${item.tone}` : ""}`}
                            onClick={() => handleNotificationSelect(item)}
                          >
                            <div className="workspace-notification-item-topline">
                              <span className="workspace-notification-item-title">{item.title}</span>
                              <span className="workspace-notification-item-meta">{item?.action?.label || "Open"}</span>
                            </div>
                            <div className="workspace-notification-item-detail">{item.detail}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
                <span className="workspace-topbar-pill">
                  <FiMapPin />
                  {settings.branchCode}
                </span>
                <span className="workspace-topbar-pill workspace-topbar-pill--soft">
                  <FiUserCheck />
                  {sessionUser?.role || "Workspace Staff"}
                </span>
                <OwnerMenu
                  settings={settings}
                  sessionUser={sessionUser}
                  onLogout={onLogout}
                  profileTone={profileTone}
                />
              </div>
            </div>
          </div>
        </header>

        <main className="page-shell">{children}</main>
      </section>

      {["Owner", "Manager"].includes(String(sessionUser?.role || "")) ? (
        <Suspense fallback={null}>
          <OwnerAssistantDock sessionUser={sessionUser} />
        </Suspense>
      ) : null}

      <GlobalCommandPalette
        key={commandPaletteOpen ? `palette-${location.pathname}` : "palette-closed"}
        open={commandPaletteOpen}
        query={commandQuery}
        onQueryChange={setCommandQuery}
        onClose={() => {
          setCommandPaletteOpen(false);
          setCommandQuery("");
        }}
        onSelect={handleCommandSelect}
        recentItems={recentCommandItems}
        items={filteredCommandItems}
      />

      {sessionUser?.forcePinChange ? (
        <ForcePinChangeModal
          sessionUser={sessionUser}
          onUserUpdate={onUserUpdate}
          onLogout={onLogout}
        />
      ) : null}
    </div>
  );
}

function App() {
  const [loggedIn, setLoggedIn] = useState(() => hasAuthSession());
  const [sessionUser, setSessionUser] = useState(() => readStoredSessionUser());
  const [sessionReady, setSessionReady] = useState(() => !hasAuthSession());
  const [darkMode, setDarkMode] = useState(() => {
    const storedTheme = localStorage.getItem("afrospice_theme");

    if (storedTheme === "dark") return true;
    if (storedTheme === "light") return false;

    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches || false;
  });
  const { settings, settingsSaving, saveSettings } = useWorkspaceSettings(loggedIn);

  useEffect(() => {
    document.body.classList.toggle("dark", darkMode);
    document.documentElement.style.colorScheme = darkMode ? "dark" : "light";
    localStorage.setItem("afrospice_theme", darkMode ? "dark" : "light");
  }, [darkMode]);

  const handleLogout = useCallback(async () => {
    if (hasAuthSession()) {
      try {
        await API.post("/auth/logout");
      } catch (error) {
        console.error("Logout sync failed:", error);
      }
    }

    clearAuthSession();
    setLoggedIn(false);
    setSessionUser(null);
    setSessionReady(true);
  }, []);

  const handleLogin = useCallback((user) => {
    setLoggedIn(true);
    setSessionUser(user || readStoredSessionUser());
    setSessionReady(true);
  }, []);

  const handleUserUpdate = useCallback((user) => {
    setSessionUser(user || null);
    writeAuthSession(user || null);
  }, []);

  useEffect(() => {
    const syncLogout = () => {
      handleLogout();
    };

    window.addEventListener("afrospice:logout", syncLogout);
    return () => window.removeEventListener("afrospice:logout", syncLogout);
  }, [handleLogout]);

  useEffect(() => {
    let ignore = false;

    const hydrateSession = async () => {
      const sessionActive = hasAuthSession();

      if (!sessionActive) {
        if (!ignore) {
          setSessionUser(null);
          setSessionReady(true);
        }
        return;
      }

      if (!ignore) {
        setSessionReady(false);
      }

      try {
        const res = await API.get("/auth/me");
        const user = res?.data?.data?.user || readStoredSessionUser();

        if (!ignore) {
          setSessionUser(user || null);
          if (user) {
            writeAuthSession(user);
          }
        }
      } catch (error) {
        console.error("Failed to hydrate session:", error);
        if (!ignore) {
          handleLogout();
        }
      } finally {
        if (!ignore) {
          setSessionReady(true);
        }
      }
    };

    hydrateSession();

    return () => {
      ignore = true;
    };
  }, [loggedIn, handleLogout]);

  const role = sessionUser?.role || null;
  const currentSettings = settings || defaultSettings;

  return (
    <div className={darkMode ? "app-shell dark" : "app-shell"}>
      <Router>
        <Suspense fallback={<RouteLoader />}>
          <Routes>
            <Route
              path="/login"
              element={
                loggedIn ? (
                  sessionReady ? (
                    <Navigate to={getDefaultRoute(role)} replace />
                  ) : (
                    <div className="app-boot-shell">Loading workspace session...</div>
                  )
                ) : (
                  <Login onLogin={handleLogin} settings={currentSettings} />
                )
              }
            />

            <Route
              path="/"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner", "Manager"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <Dashboard settings={currentSettings} />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/pos-dashboard"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner", "Manager", "Inventory Clerk"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <POSDashboard lowStockThreshold={Number(currentSettings.lowStockThreshold || 10)} />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/terminal"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner", "Manager", "Cashier"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <POS settings={currentSettings} />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/orders"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner", "Manager"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <Orders settings={currentSettings} />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/orders/new"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner", "Manager", "Cashier"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <POS settings={currentSettings} mode="createOrder" />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/reports"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner", "Manager"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <Reports settings={currentSettings} />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/customers"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner", "Manager"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <Customers settings={currentSettings} />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/customers/new"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner", "Manager"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <CustomerProfile settings={currentSettings} />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/customers/:customerId"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner", "Manager"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <CustomerProfile settings={currentSettings} />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/suppliers"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner", "Manager", "Inventory Clerk"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <Suppliers settings={currentSettings} />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/users"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner", "Manager"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <Users currentUser={sessionUser} />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/users/staff/new"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner", "Manager"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <UserManagementDesk currentUser={sessionUser} />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/users/staff/:userId"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner", "Manager"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <UserManagementDesk currentUser={sessionUser} />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route
              path="/settings"
              element={
                <ProtectedRoute
                  loggedIn={loggedIn}
                  sessionReady={sessionReady}
                  userRole={role}
                  allowedRoles={["Owner", "Manager"]}
                >
                  <AppShell settings={currentSettings} sessionUser={sessionUser} onLogout={handleLogout} onUserUpdate={handleUserUpdate}>
                    <Settings
                      key={currentSettings.updatedAt || currentSettings.branchCode || "settings"}
                      darkMode={darkMode}
                      setDarkMode={setDarkMode}
                      settings={currentSettings}
                      onSaveSettings={saveSettings}
                      settingsSaving={settingsSaving}
                      currentUser={sessionUser}
                      onLogout={handleLogout}
                    />
                  </AppShell>
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </Router>
    </div>
  );
}

export default App;

