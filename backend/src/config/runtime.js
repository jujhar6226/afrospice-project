require("./loadEnv");

const crypto = require("crypto");

function readBoundedInteger(rawValue, fallbackValue, options = {}) {
  const minimum = Number.isFinite(options.min) ? Number(options.min) : Number.MIN_SAFE_INTEGER;
  const maximum = Number.isFinite(options.max) ? Number(options.max) : Number.MAX_SAFE_INTEGER;
  const parsed = Number(rawValue);

  if (!Number.isFinite(parsed)) {
    return fallbackValue;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function readBoolean(rawValue, fallbackValue = false) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallbackValue;
  }

  return String(rawValue).trim().toLowerCase() === "true";
}

function readCookieSameSite(rawValue, fallbackValue = "strict") {
  const normalized = String(rawValue || fallbackValue).trim().toLowerCase();

  if (["lax", "strict", "none"].includes(normalized)) {
    return normalized;
  }

  return fallbackValue;
}

function readTrustProxy(rawValue, fallbackValue = false) {
  if (rawValue === undefined || rawValue === null || rawValue === "") {
    return fallbackValue;
  }

  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;

  const numeric = Number(normalized);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return Math.round(numeric);
  }

  return String(rawValue).trim();
}

const environment = String(process.env.NODE_ENV || "development").trim() || "development";
const isProduction = environment === "production";
const isDevelopment = !isProduction;
const requestedMongoUri = String(process.env.MONGO_URI || "").trim();

function resolveMongoUri() {
  const raw = String(process.env.MONGO_URI || "").trim();
  if (!raw) {
    return isDevelopment ? "memory" : "";
  }
  if (isDevelopment && raw.toLowerCase() === "memory") {
    return "memory";
  }
  return raw;
}

const requestedAuthBypass = String(process.env.DISABLE_AUTH || "").toLowerCase() === "true";
const authBypassEnabled = requestedAuthBypass && isDevelopment;

const requestedJwtSecret = String(process.env.JWT_SECRET || "").trim();
const minimumJwtSecretLength = 32;
const generatedDevelopmentJwtSecret =
  !requestedJwtSecret && isDevelopment ? crypto.randomBytes(48).toString("hex") : "";
const jwtSecret = requestedJwtSecret || generatedDevelopmentJwtSecret;
const jwtIssuer = String(process.env.JWT_ISSUER || "afrospice-api").trim() || "afrospice-api";
const jwtAudience =
  String(process.env.JWT_AUDIENCE || "afrospice-workspace").trim() || "afrospice-workspace";
const jwtExpires = String(process.env.JWT_EXPIRES || "12h").trim() || "12h";
const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim();
const trustProxy = readTrustProxy(process.env.TRUST_PROXY, isProduction ? 1 : false);
const enforceHttps = isProduction && readBoolean(process.env.ENFORCE_HTTPS, true);
const authCookieName =
  String(
    process.env.AUTH_COOKIE_NAME || (isProduction ? "__Host-afrospice_session" : "afrospice_session")
  ).trim() || (isProduction ? "__Host-afrospice_session" : "afrospice_session");
const authCookieSecure = readBoolean(process.env.AUTH_COOKIE_SECURE, isProduction);
const authCookieSameSite = readCookieSameSite(process.env.AUTH_COOKIE_SAMESITE, "strict");
const sessionIdleTimeoutMinutes = readBoundedInteger(
  process.env.SESSION_IDLE_TIMEOUT_MINUTES,
  isProduction ? 12 * 60 : 24 * 60,
  { min: 5, max: 7 * 24 * 60 }
);
const sessionAbsoluteTimeoutMinutes = readBoundedInteger(
  process.env.SESSION_ABSOLUTE_TIMEOUT_MINUTES,
  7 * 24 * 60,
  { min: 30, max: 30 * 24 * 60 }
);
const authLoginRateLimitMax = readBoundedInteger(process.env.AUTH_LOGIN_RATE_LIMIT_MAX, 10, {
  min: 3,
  max: 50,
});
const authChangePinRateLimitMax = readBoundedInteger(
  process.env.AUTH_CHANGE_PIN_RATE_LIMIT_MAX,
  8,
  {
    min: 2,
    max: 30,
  }
);

if (generatedDevelopmentJwtSecret) {
  console.warn(
    "JWT_SECRET is not set. Generated an ephemeral development secret for this process."
  );
}

const frontendOrigins = String(process.env.FRONTEND_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOrigins =
  frontendOrigins.length > 0
    ? frontendOrigins
    : isDevelopment
      ? ["http://localhost:5173", "http://127.0.0.1:5173"]
      : [];

const rateLimitEnabled =
  isProduction && String(process.env.DISABLE_RATE_LIMIT || "").toLowerCase() !== "true";

const openAiApiKey = String(process.env.OPENAI_API_KEY || "").trim();
const openAiModel = String(process.env.OPENAI_MODEL || "").trim() || "gpt-5-mini";
const openAiBaseUrl =
  String(process.env.OPENAI_BASE_URL || "").trim() || "https://api.openai.com/v1";
const requestedExternalAssistant = String(process.env.EXTERNAL_ASSISTANT_ENABLED || "")
  .trim()
  .toLowerCase();
const externalAssistantEnabled =
  requestedExternalAssistant === ""
    ? Boolean(openAiApiKey)
    : requestedExternalAssistant === "true" && Boolean(openAiApiKey);
const rawOpenAiTimeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || 15000);
const openAiTimeoutMs = Number.isFinite(rawOpenAiTimeoutMs)
  ? Math.max(5000, Math.min(30000, Math.round(rawOpenAiTimeoutMs)))
  : 15000;
const requestedBootstrapSampleData = String(process.env.BOOTSTRAP_SAMPLE_DATA || "")
  .trim()
  .toLowerCase();
const bootstrapSampleData = requestedBootstrapSampleData === "true";

function assertRuntimeConfig() {
  const rawMongo = String(process.env.MONGO_URI || "").trim();
  if (isProduction) {
    if (!rawMongo || rawMongo.toLowerCase() === "memory") {
      throw new Error("MONGO_URI must be configured with a real connection string in production.");
    }
  }

  if (!resolveMongoUri()) {
    throw new Error("MONGO_URI must be configured.");
  }

  if (isProduction && requestedAuthBypass) {
    throw new Error("DISABLE_AUTH must not be enabled in production.");
  }

  if (isProduction && !requestedJwtSecret) {
    throw new Error("JWT_SECRET must be configured before running in production.");
  }

  if (requestedJwtSecret && requestedJwtSecret.length < minimumJwtSecretLength) {
    throw new Error(
      `JWT_SECRET must be at least ${minimumJwtSecretLength} characters long.`
    );
  }

  if (isProduction && !authCookieSecure) {
    throw new Error("AUTH_COOKIE_SECURE must be true in production.");
  }

  if (authCookieSameSite === "none" && !authCookieSecure) {
    throw new Error("AUTH_COOKIE_SAMESITE=none requires AUTH_COOKIE_SECURE=true.");
  }

  if (authCookieName.startsWith("__Host-") && !authCookieSecure) {
    throw new Error("Host-prefixed auth cookies require AUTH_COOKIE_SECURE=true.");
  }

  if (sessionAbsoluteTimeoutMinutes < sessionIdleTimeoutMinutes) {
    throw new Error(
      "SESSION_ABSOLUTE_TIMEOUT_MINUTES must be greater than or equal to SESSION_IDLE_TIMEOUT_MINUTES."
    );
  }

  if (isProduction && !publicBaseUrl) {
    throw new Error("PUBLIC_BASE_URL must be configured before running in production.");
  }

  if (isProduction && !/^https:\/\//i.test(publicBaseUrl)) {
    throw new Error("PUBLIC_BASE_URL must use HTTPS in production.");
  }

  if (isProduction && frontendOrigins.length === 0) {
    throw new Error("FRONTEND_ORIGIN must be configured before running in production.");
  }

  if (
    isProduction &&
    frontendOrigins.some((origin) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin))
  ) {
    throw new Error("FRONTEND_ORIGIN must not use localhost or 127.0.0.1 in production.");
  }

  if (isProduction && enforceHttps && trustProxy === false) {
    throw new Error("TRUST_PROXY must be configured when ENFORCE_HTTPS is enabled in production.");
  }

  if (
    isProduction &&
    externalAssistantEnabled &&
    !/^https:\/\//i.test(openAiBaseUrl)
  ) {
    throw new Error("OPENAI_BASE_URL must use HTTPS when external AI routing is enabled in production.");
  }
}

const runtimeExports = {
  environment,
  isProduction,
  isDevelopment,
  resolveMongoUri,
  mongoUriConfigured: Boolean(requestedMongoUri),
  authBypassEnabled,
  requestedAuthBypass,
  jwtSecret,
  jwtSecretConfigured: Boolean(requestedJwtSecret),
  minimumJwtSecretLength,
  jwtIssuer,
  jwtAudience,
  jwtExpires,
  publicBaseUrl,
  trustProxy,
  enforceHttps,
  authCookieName,
  authCookieSecure,
  authCookieSameSite,
  sessionIdleTimeoutMinutes,
  sessionAbsoluteTimeoutMinutes,
  authLoginRateLimitMax,
  authChangePinRateLimitMax,
  allowedOrigins,
  rateLimitEnabled,
  openAiApiKey,
  openAiModel,
  openAiBaseUrl,
  openAiTimeoutMs,
  externalAssistantEnabled,
  bootstrapSampleData,
  assertRuntimeConfig,
};

Object.defineProperty(runtimeExports, "mongoUri", {
  enumerable: true,
  get() {
    return resolveMongoUri();
  },
});

module.exports = runtimeExports;
