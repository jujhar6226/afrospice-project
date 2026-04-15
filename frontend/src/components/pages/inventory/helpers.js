export const emptyForm = {
  name: "",
  sku: "",
  barcode: "",
  category: "",
  supplier: "",
  price: "",
  unitCost: "",
  stock: "",
};

const normalizeCollection = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.products)) return data.products;
  return [];
};

export const normalizeProductsResponse = (data) => normalizeCollection(data);
export const normalizePurchaseOrdersResponse = (data) => normalizeCollection(data);
export const normalizeMovementsResponse = (data) => normalizeCollection(data);

export const normalizeCycleCountsResponse = (data) =>
  normalizeCollection(data).map((count) => ({
    ...count,
    items: Array.isArray(count?.items) ? count.items : [],
  }));

export const sanitizeText = (value) => String(value || "").trim();
export const normalizeCode = (value) => sanitizeText(value).toLowerCase();
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const normalizeCurrency = (currency) => {
  const code = String(currency || "CAD").trim().toUpperCase();
  return code === "USD" ? "CAD" : code || "CAD";
};

const getCurrencyLocale = (currency) => {
  const code = normalizeCurrency(currency);
  return code === "CAD" ? "en-CA" : "en-US";
};

const resolveMoneyArgs = (first, second) => {
  const firstCode = typeof first === "string" ? first.trim().toUpperCase() : "";
  const secondCode = typeof second === "string" ? second.trim().toUpperCase() : "";
  const firstLooksLikeCurrency = /^[A-Z]{3}$/.test(firstCode);
  const secondLooksLikeCurrency = /^[A-Z]{3}$/.test(secondCode);

  if (firstLooksLikeCurrency && !secondLooksLikeCurrency) {
    return {
      currency: firstCode,
      value: second,
    };
  }

  if (secondLooksLikeCurrency) {
    return {
      currency: secondCode,
      value: first,
    };
  }

  return {
    currency: "CAD",
    value: first,
  };
};

export const formatMoney = (first, second = "CAD") => {
  const { currency, value } = resolveMoneyArgs(first, second);
  const num = Number(value || 0);
  const code = normalizeCurrency(currency);
  return new Intl.NumberFormat(getCurrencyLocale(code), {
    style: "currency",
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
};

export const formatDate = (value) => {
  if (!value) return "No recent sale";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No recent sale";
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
};

export const formatDateTime = (value) => {
  if (!value) return "No activity yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity yet";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
};

export const formatRelativeTime = (value, now = Date.now()) => {
  if (!value) return "No activity yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity yet";

  const diffMs = Math.max(0, Number(now) - date.getTime());
  const diffMinutes = Math.floor(diffMs / 60000);

  if (diffMinutes <= 0) return "just now";
  if (diffMinutes === 1) return "1 min ago";
  if (diffMinutes < 60) return `${diffMinutes} mins ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours === 1) return "1 hr ago";
  if (diffHours < 24) return `${diffHours} hrs ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return "1 day ago";
  return `${diffDays} days ago`;
};

export const makeSkuFromName = (name) => {
  const cleaned = String(name || "")
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.slice(0, 4).toUpperCase())
    .join("-");

  return cleaned ? `SKU-${cleaned}` : "";
};

export const getStatusTone = (status) => {
  if (status === "Healthy") return "success";
  if (status === "Dormant" || status === "Reorder Soon") return "warning";
  return "danger";
};

export const getPurchaseOrderTone = (status) => {
  if (status === "Received") return "success";
  if (status === "Partially Received" || status === "Sent") return "warning";
  if (status === "Cancelled") return "danger";
  return "neutral";
};

export const getMovementLabel = (movementType) => {
  if (movementType === "purchase_receive") return "PO Receive";
  if (movementType === "restock") return "Restock";
  if (movementType === "sale") return "Sale";
  if (movementType === "create") return "New Line";
  if (movementType === "cycle_adjustment") return "Count Var";
  return "Adjustment";
};

export const escapeCsv = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
