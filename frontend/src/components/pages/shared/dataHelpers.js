export function getResponseData(response) {
  return response?.data?.data ?? response?.data ?? null;
}

export function toArray(value) {
  return Array.isArray(value) ? value : [];
}

export function toObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeCurrency(currency) {
  const code = String(currency || "CAD").trim().toUpperCase();
  return code === "USD" ? "CAD" : code || "CAD";
}

function getCurrencyLocale(currency) {
  const code = normalizeCurrency(currency);
  return code === "CAD" ? "en-CA" : "en-US";
}

function resolveMoneyArgs(first, second) {
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
}

export function formatMoney(first, second) {
  const { currency, value } = resolveMoneyArgs(first, second);
  const code = normalizeCurrency(currency);
  return new Intl.NumberFormat(getCurrencyLocale(code), {
    style: "currency",
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toNumber(value));
}

export function formatPercent(value, digits = 1) {
  return `${toNumber(value).toFixed(digits)}%`;
}

export function formatDate(value) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
}

export function firstArrayFrom(source, keys = []) {
  if (!source || typeof source !== "object") return [];

  for (const key of keys) {
    const candidate = source?.[key];
    if (Array.isArray(candidate)) return candidate;
  }

  return [];
}

export function firstNumberFrom(source, keys = [], fallback = 0) {
  if (!source || typeof source !== "object") return fallback;

  for (const key of keys) {
    const candidate = Number(source?.[key]);
    if (Number.isFinite(candidate)) return candidate;
  }

  return fallback;
}
