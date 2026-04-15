export const NAV_ITEMS = [
  {
    path: "/",
    label: "Dashboard",
    eyebrow: "Executive Flight Deck",
    description: "Revenue, stock, cash, and next decisions in one owner view.",
    allowedRoles: ["Owner", "Manager"],
  },
  {
    path: "/pos-dashboard",
    label: "Inventory",
    eyebrow: "Inventory Command",
    description: "Replenishment, receiving, counts, and stock control.",
    allowedRoles: ["Owner", "Manager", "Inventory Clerk"],
  },
  {
    path: "/terminal",
    label: "POS Terminal",
    eyebrow: "Checkout Studio",
    description: "Fast selling, clean receipts, and live checkout control.",
    allowedRoles: ["Owner", "Manager", "Cashier"],
  },
  {
    path: "/orders",
    label: "Orders",
    eyebrow: "Transaction Intelligence",
    description: "Order quality, payment flow, channels, and cashier performance.",
    allowedRoles: ["Owner", "Manager"],
  },
  {
    path: "/reports",
    label: "Reports",
    eyebrow: "Strategy Studio",
    description: "Growth, category strength, product leaders, and forecasting.",
    allowedRoles: ["Owner", "Manager"],
  },
  {
    path: "/customers",
    label: "Customers",
    eyebrow: "Customer Intelligence",
    description: "Retention, named demand, walk-in dependence, and account quality.",
    allowedRoles: ["Owner", "Manager"],
  },
  {
    path: "/suppliers",
    label: "Suppliers",
    eyebrow: "Supplier Control",
    description: "Inbound exposure, fill rate, lead time, and supplier pressure.",
    allowedRoles: ["Owner", "Manager", "Inventory Clerk"],
  },
  {
    path: "/users",
    label: "User Management",
    eyebrow: "Workforce Control",
    description: "Staff roles, roster health, and access discipline.",
    allowedRoles: ["Owner", "Manager"],
  },
  {
    path: "/settings",
    label: "Settings",
    eyebrow: "Operating Controls",
    description: "Store profile, checkout policies, and workspace rules.",
    allowedRoles: ["Owner", "Manager"],
  },
];

export function canAccessRoute(role, allowedRoles = []) {
  if (!allowedRoles.length) return true;
  if (!role) return false;
  return allowedRoles.includes(role);
}

export function getVisibleNavItems(role) {
  return NAV_ITEMS.filter((item) => canAccessRoute(role, item.allowedRoles));
}

export function getDefaultRoute(role) {
  return getVisibleNavItems(role)[0]?.path || "/terminal";
}

export function getRouteMeta(pathname) {
  return (
    NAV_ITEMS.find((item) =>
      item.path === "/" ? pathname === "/" : pathname.startsWith(item.path)
    ) || NAV_ITEMS[0]
  );
}
