const runtime = require("../config/runtime");
const { decodeToken } = require("./jwt");

function parseCookieHeader(headerValue) {
  return String(headerValue || "")
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((cookies, entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex <= 0) {
        return cookies;
      }

      const name = entry.slice(0, separatorIndex).trim();
      const value = entry.slice(separatorIndex + 1).trim();

      if (!name) {
        return cookies;
      }

      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function getTokenExpiryDate(token) {
  const decoded = decodeToken(token);
  const exp = Number(decoded?.exp);

  if (!Number.isFinite(exp) || exp <= 0) {
    return null;
  }

  const expiresAt = new Date(exp * 1000);
  return Number.isNaN(expiresAt.getTime()) ? null : expiresAt;
}

function buildCookieBaseOptions() {
  return {
    httpOnly: true,
    secure: runtime.authCookieSecure,
    sameSite: runtime.authCookieSameSite,
    path: "/",
  };
}

function buildAuthCookieOptions(token) {
  const expiresAt = getTokenExpiryDate(token);

  if (!expiresAt) {
    return buildCookieBaseOptions();
  }

  return {
    ...buildCookieBaseOptions(),
    expires: expiresAt,
    maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
  };
}

function getRequestAuthToken(req) {
  const authHeader = String(req?.headers?.authorization || "").trim();

  if (authHeader.startsWith("Bearer ")) {
    return authHeader.replace("Bearer ", "").trim();
  }

  const cookies = parseCookieHeader(req?.headers?.cookie || "");
  return String(cookies[runtime.authCookieName] || "").trim();
}

function setAuthCookie(res, token) {
  res.cookie(runtime.authCookieName, token, buildAuthCookieOptions(token));
}

function clearAuthCookie(res) {
  res.clearCookie(runtime.authCookieName, buildCookieBaseOptions());
}

module.exports = {
  getRequestAuthToken,
  setAuthCookie,
  clearAuthCookie,
};
