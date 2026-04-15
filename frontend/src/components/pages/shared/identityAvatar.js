const IDENTITY_TONES = ["violet", "purple", "blue", "cyan", "pink"];

export function getIdentityInitials(value = "", fallback = "ID") {
  const initials = String(value || "")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || String(fallback || "ID").slice(0, 2).toUpperCase();
}

export function getIdentityTone(value = "", fallback = "blue") {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return fallback;

  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }

  return IDENTITY_TONES[hash % IDENTITY_TONES.length] || fallback;
}
