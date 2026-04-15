const runtime = require("../config/runtime");
const systemRepository = require("../data/repositories/systemRepository");
const { mongoose } = require("../config/db");

function getMongoConnectionStateLabel() {
  const states = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  return states[mongoose.connection.readyState] || "unknown";
}

function parseMongoUri(uri) {
  try {
    const parsed = new URL(uri);
    const dbName = String(parsed.pathname || "").replace(/^\/+/, "") || null;
    return {
      protocol: String(parsed.protocol || "").replace(/:$/, ""),
      host: parsed.hostname || null,
      port: parsed.port ? Number(parsed.port) : null,
      database: dbName,
    };
  } catch {
    return {
      protocol: "mongodb",
      host: null,
      port: null,
      database: null,
    };
  }
}

function listAiProviders() {
  return [
    {
      key: "openai",
      name: "OpenAI",
      configured: Boolean(runtime.openAiApiKey),
      routingSupported: true,
      routingEnabled: Boolean(runtime.externalAssistantEnabled),
    },
    {
      key: "anthropic",
      name: "Anthropic",
      configured: Boolean(process.env.ANTHROPIC_API_KEY),
      routingSupported: false,
      routingEnabled: false,
    },
    {
      key: "gemini",
      name: "Google Gemini",
      configured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      routingSupported: false,
      routingEnabled: false,
    },
  ];
}

function getActiveAiProvider(providers) {
  return (
    providers.find(
      (provider) => provider.configured && provider.routingSupported && provider.routingEnabled
    ) || null
  );
}

function buildReadinessCheck(key, label, status, message, meta = {}) {
  return {
    key,
    label,
    status,
    message,
    ...meta,
  };
}

function hasLocalOrigin(origins = []) {
  return origins.some((origin) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin));
}

function summarizeReadiness(checks) {
  const failureCount = checks.filter((check) => check.status === "fail").length;
  const warningCount = checks.filter((check) => check.status === "warn").length;

  if (failureCount > 0) {
    return {
      status: "not_ready",
      failureCount,
      warningCount,
      message: "Deployment readiness failed. Resolve the failed checks before going live.",
    };
  }

  if (warningCount > 0) {
    return {
      status: "ready_with_warnings",
      failureCount,
      warningCount,
      message: "Deployment readiness passed with warnings. Review the advisory checks before release.",
    };
  }

  return {
    status: "ready",
    failureCount: 0,
    warningCount: 0,
    message: "Deployment readiness passed.",
  };
}

function getHealth() {
  return {
    status: "ok",
    timestamp: new Date().toISOString(),
  };
}

async function getHealthDetails() {
  const parsedUri = parseMongoUri(runtime.mongoUri);
  const storage = await systemRepository.getStorageInfo();
  const deployment = (await systemRepository.getMongoDeploymentInfo?.()) || {};
  const transactions = deployment.transactions || {
    nativeSupported: false,
    fallbackEnabled: runtime.isDevelopment,
    effectiveMode: runtime.isDevelopment ? "development-fallback" : "unavailable",
  };

  return {
    service: "AfroSpice API",
    status: "ok",
    uptimeSeconds: Number(process.uptime().toFixed(1)),
    timestamp: new Date().toISOString(),
    environment: runtime.environment,
    mongo: {
      state: getMongoConnectionStateLabel(),
      host: mongoose.connection.host || parsedUri.host || null,
      port: mongoose.connection.port || parsedUri.port || null,
      database: mongoose.connection.name || parsedUri.database || null,
      uriConfigured: Boolean(runtime.mongoUriConfigured),
      protocol: parsedUri.protocol,
      topology: deployment.topology || "unknown",
      replicaSetName: deployment.replicaSetName || null,
      isWritablePrimary:
        deployment.isWritablePrimary === undefined ? null : deployment.isWritablePrimary,
      logicalSessionTimeoutMinutes:
        deployment.logicalSessionTimeoutMinutes === undefined
          ? null
          : deployment.logicalSessionTimeoutMinutes,
      hosts: Array.isArray(deployment.hosts) ? deployment.hosts : [],
      transactions,
    },
    storage,
  };
}

function getAiStatus() {
  const providers = listAiProviders();
  const activeProvider = getActiveAiProvider(providers);
  const openAiConfigured = Boolean(runtime.openAiApiKey);
  const externalRoutingEnabled = Boolean(runtime.externalAssistantEnabled);

  return {
    enabled: true,
    configured: Boolean(activeProvider),
    provider: activeProvider?.name || null,
    model: activeProvider ? runtime.openAiModel : null,
    status: activeProvider
      ? "grounded-external-hybrid-live"
      : "grounded-assistant-live",
    mode: activeProvider ? "grounded-external-hybrid" : "grounded-assistant",
    message: activeProvider
      ? `The grounded owner assistant is live and external model routing is enabled via OpenAI (${runtime.openAiModel}) with validated structured prompts.`
      : openAiConfigured && !externalRoutingEnabled
        ? "The grounded owner assistant is live. OpenAI is configured, but external routing is currently disabled by environment settings."
        : "The grounded owner assistant is live. External model routing is implemented and will activate when OPENAI_API_KEY is configured.",
    checks: {
      providerConfigured: Boolean(activeProvider),
      openAiConfigured,
      externalRoutingEnabled,
      groundedAssistantAvailable: true,
      liveRequestsImplemented: true,
      externalModelRequestsImplemented: true,
      inventoryIntelligenceAvailable: true,
      dailyBriefingAvailable: true,
      restockSuggestionsAvailable: true,
      riskAlertsAvailable: true,
      salesInsightsAvailable: true,
    },
    providers,
  };
}

async function getReadinessReport() {
  const details = await getHealthDetails();
  const aiStatus = getAiStatus();
  const counts = details?.storage?.counts || {};
  const transactions = details?.mongo?.transactions || {};
  const coreCollections = ["roles", "users", "products", "customers", "suppliers"];
  const missingCollections = coreCollections.filter((key) => Number(counts[key] || 0) === 0);
  const checks = [];

  checks.push(
    buildReadinessCheck(
      "mongo-connected",
      "MongoDB connectivity",
      details?.mongo?.state === "connected" ? "pass" : "fail",
      details?.mongo?.state === "connected"
        ? "MongoDB is connected."
        : "MongoDB is not connected."
    )
  );

  checks.push(
    buildReadinessCheck(
      "transactions-native",
      "Native transaction support",
      transactions.nativeSupported ? "pass" : runtime.isProduction ? "fail" : "warn",
      transactions.nativeSupported
        ? "Replica-set transaction support is active."
        : "Native multi-document transactions are not available."
    )
  );

  checks.push(
    buildReadinessCheck(
      "auth-bypass-disabled",
      "Auth bypass disabled",
      runtime.authBypassEnabled ? "fail" : "pass",
      runtime.authBypassEnabled
        ? "DISABLE_AUTH is enabled."
        : "Authentication bypass is disabled."
    )
  );

  checks.push(
    buildReadinessCheck(
      "bootstrap-disabled",
      "Runtime sample bootstrap disabled",
      runtime.bootstrapSampleData ? (runtime.isProduction ? "fail" : "warn") : "pass",
      runtime.bootstrapSampleData
        ? "BOOTSTRAP_SAMPLE_DATA is enabled."
        : "Runtime sample bootstrap is disabled."
    )
  );

  checks.push(
    buildReadinessCheck(
      "jwt-secret-configured",
      "Configured JWT secret",
      runtime.jwtSecretConfigured ? "pass" : runtime.isProduction ? "fail" : "warn",
      runtime.jwtSecretConfigured
        ? "JWT secret is explicitly configured."
        : "Runtime is using an ephemeral development JWT secret."
    )
  );

  checks.push(
    buildReadinessCheck(
      "frontend-origins",
      "Frontend origin allowlist",
      runtime.allowedOrigins.length === 0
        ? "fail"
        : runtime.isProduction && hasLocalOrigin(runtime.allowedOrigins)
          ? "fail"
          : "pass",
      runtime.allowedOrigins.length === 0
        ? "No frontend origins are configured."
        : runtime.isProduction && hasLocalOrigin(runtime.allowedOrigins)
          ? "Production origin allowlist still includes localhost."
          : "Frontend origin allowlist is configured."
    )
  );

  checks.push(
    buildReadinessCheck(
      "public-base-url",
      "Public API base URL",
      !runtime.publicBaseUrl
        ? runtime.isProduction
          ? "fail"
          : "warn"
        : runtime.isProduction && !/^https:\/\//i.test(runtime.publicBaseUrl)
          ? "fail"
          : "pass",
      !runtime.publicBaseUrl
        ? "PUBLIC_BASE_URL is not configured."
        : runtime.isProduction && !/^https:\/\//i.test(runtime.publicBaseUrl)
          ? "PUBLIC_BASE_URL must use HTTPS in production."
          : "Public API base URL is configured."
    )
  );

  checks.push(
    buildReadinessCheck(
      "https-enforcement",
      "HTTPS enforcement",
      runtime.enforceHttps ? "pass" : runtime.isProduction ? "fail" : "warn",
      runtime.enforceHttps
        ? "HTTPS enforcement is enabled."
        : "HTTPS enforcement is disabled."
    )
  );

  checks.push(
    buildReadinessCheck(
      "trust-proxy",
      "Proxy trust configuration",
      runtime.trustProxy === false
        ? runtime.isProduction && runtime.enforceHttps
          ? "fail"
          : "warn"
        : "pass",
      runtime.trustProxy === false
        ? "Express trust proxy is disabled."
        : "Express trust proxy is configured."
    )
  );

  checks.push(
    buildReadinessCheck(
      "secure-cookie",
      "Secure session cookie posture",
      runtime.authCookieSecure ? "pass" : runtime.isProduction ? "fail" : "warn",
      runtime.authCookieSecure
        ? `Auth cookie is secure with SameSite=${runtime.authCookieSameSite}.`
        : "Auth cookie secure flag is disabled."
    )
  );

  checks.push(
    buildReadinessCheck(
      "core-business-data",
      "Core business collections populated",
      missingCollections.length === 0 ? "pass" : runtime.isProduction ? "fail" : "warn",
      missingCollections.length === 0
        ? "Core business collections contain live records."
        : `These collections are empty: ${missingCollections.join(", ")}.`
    )
  );

  checks.push(
    buildReadinessCheck(
      "grounded-ai",
      "Grounded AI assistant runtime",
      aiStatus?.checks?.groundedAssistantAvailable ? "pass" : "fail",
      aiStatus?.checks?.groundedAssistantAvailable
        ? "Grounded assistant runtime is available."
        : "Grounded assistant runtime is unavailable."
    )
  );

  checks.push(
    buildReadinessCheck(
      "external-ai-routing",
      "External AI routing configuration",
      aiStatus?.checks?.externalRoutingEnabled ? "pass" : "warn",
      aiStatus?.checks?.externalRoutingEnabled
        ? "External AI routing is configured."
        : "External AI routing is disabled. Grounded assistant remains available."
    )
  );

  return {
    checkedAt: new Date().toISOString(),
    environment: runtime.environment,
    summary: summarizeReadiness(checks),
    checks,
    operations: {
      publicBaseUrlConfigured: Boolean(runtime.publicBaseUrl),
      frontendOrigins: runtime.allowedOrigins,
      trustProxy: runtime.trustProxy,
      enforceHttps: runtime.enforceHttps,
      authCookieName: runtime.authCookieName,
      authCookieSecure: runtime.authCookieSecure,
      authCookieSameSite: runtime.authCookieSameSite,
    },
    storage: {
      counts,
      missingCollections,
    },
    mongo: {
      state: details?.mongo?.state || "unknown",
      topology: details?.mongo?.topology || "unknown",
      replicaSetName: details?.mongo?.replicaSetName || null,
      transactions,
    },
  };
}

async function getBackupSnapshot() {
  return await systemRepository.getBackupSnapshot();
}

module.exports = {
  getHealth,
  getHealthDetails,
  getReadinessReport,
  getAiStatus,
  getBackupSnapshot,
};
