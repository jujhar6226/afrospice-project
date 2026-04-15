const TOKEN_KEY = "afrospice_token";
const USER_KEY = "afrospice_user";
const SESSION_KEY = "afrospice_session_active";

function readSessionStorage(key) {
  return window.sessionStorage.getItem(key);
}

function readLocalStorage(key) {
  return window.localStorage.getItem(key);
}

function removeLegacyToken() {
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(TOKEN_KEY);
}

function markSessionActive() {
  window.localStorage.setItem(SESSION_KEY, "1");
  window.sessionStorage.removeItem(SESSION_KEY);
}

function migrateLegacySessionIfPresent() {
  const legacyToken = readSessionStorage(TOKEN_KEY) || readLocalStorage(TOKEN_KEY);

  if (!legacyToken) {
    return false;
  }

  markSessionActive();
  removeLegacyToken();
  return true;
}

function readStorage(key) {
  const sessionValue = readSessionStorage(key);
  if (sessionValue) {
    return sessionValue;
  }

  const localValue = readLocalStorage(key);
  if (localValue) {
    window.sessionStorage.setItem(key, localValue);
    window.localStorage.removeItem(key);
    return localValue;
  }

  return null;
}

export function hasAuthSession() {
  if (typeof window === "undefined") return false;

  try {
    return Boolean(readStorage(SESSION_KEY) || migrateLegacySessionIfPresent());
  } catch {
    return false;
  }
}

export function readStoredUser() {
  if (typeof window === "undefined") return null;

  try {
    const raw = readStorage(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function writeAuthSession(user = null) {
  if (typeof window === "undefined") return;

  try {
    markSessionActive();
    removeLegacyToken();

    if (user) {
      window.sessionStorage.setItem(USER_KEY, JSON.stringify(user));
      window.localStorage.removeItem(USER_KEY);
    } else {
      window.sessionStorage.removeItem(USER_KEY);
      window.localStorage.removeItem(USER_KEY);
    }
  } catch {
    // Intentionally silent: server-side auth remains authoritative.
  }
}

export function clearAuthSession() {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.removeItem(SESSION_KEY);
    window.sessionStorage.removeItem(USER_KEY);
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(SESSION_KEY);
    window.localStorage.removeItem(USER_KEY);
    window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Intentionally silent.
  }
}
