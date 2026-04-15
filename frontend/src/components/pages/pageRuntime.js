export const LIVE_PAGE_POLL_INTERVAL_MS = 30000;
const LIVE_CACHE_VERSION = 2;

function normalizeCurrency(currency) {
  const code = String(currency || "CAD").trim().toUpperCase();
  return code === "USD" ? "CAD" : code || "CAD";
}

export function formatMoneyLabel(currency, value) {
  const code = normalizeCurrency(currency);
  return new Intl.NumberFormat(code === "CAD" ? "en-CA" : "en-US", {
    style: "currency",
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export function formatPercentLabel(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

export function readCachedPayload(cacheKey) {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (parsed?.meta?.cacheVersion !== LIVE_CACHE_VERSION) {
      return null;
    }

    if (!parsed?.payload || (!parsed.payload.summary && !parsed.payload.executiveSummary)) {
      return null;
    }

    return parsed.payload;
  } catch {
    return null;
  }
}

export function writeCachedPayload(cacheKey, payload) {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      cacheKey,
      JSON.stringify({
        meta: {
          cacheVersion: LIVE_CACHE_VERSION,
          cachedAt: new Date().toISOString(),
        },
        payload,
      })
    );
  } catch {
    // Ignore local cache failures and keep the live page path working.
  }
}

export function formatRelativeTimeLabel(value, nowTick) {
  if (!value) return "not refreshed yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "not refreshed yet";

  const diffMinutes = Math.floor(Math.max(0, nowTick - date.getTime()) / 60000);
  if (diffMinutes <= 0) return "just now";
  if (diffMinutes === 1) return "1 min ago";
  if (diffMinutes < 60) return `${diffMinutes} mins ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours === 1) return "1 hr ago";
  if (diffHours < 24) return `${diffHours} hrs ago`;

  return `${Math.floor(diffHours / 24)} days ago`;
}
