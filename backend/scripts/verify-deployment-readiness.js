require("../src/config/loadEnv");

const runtime = require("../src/config/runtime");
const { connectDB, disconnectDB } = require("../src/config/db");
const systemService = require("../src/services/systemService");

function printSection(title) {
  console.log(`\n=== ${title} ===`);
}

function printKeyValue(key, value) {
  console.log(`${key}: ${value}`);
}

async function run() {
  runtime.assertRuntimeConfig();
  await connectDB();

  const readiness = await systemService.getReadinessReport();
  const summary = readiness?.summary || {};
  const checks = Array.isArray(readiness?.checks) ? readiness.checks : [];

  printSection("Deployment Readiness");
  printKeyValue("environment", readiness.environment || runtime.environment);
  printKeyValue("status", summary.status || "unknown");
  printKeyValue("message", summary.message || "n/a");
  printKeyValue("failures", summary.failureCount || 0);
  printKeyValue("warnings", summary.warningCount || 0);

  printSection("Operational Profile");
  printKeyValue("publicBaseUrlConfigured", readiness?.operations?.publicBaseUrlConfigured ? "yes" : "no");
  printKeyValue("frontendOrigins", (readiness?.operations?.frontendOrigins || []).join(", ") || "none");
  printKeyValue("trustProxy", readiness?.operations?.trustProxy ?? "false");
  printKeyValue("enforceHttps", readiness?.operations?.enforceHttps ? "yes" : "no");
  printKeyValue("authCookieSecure", readiness?.operations?.authCookieSecure ? "yes" : "no");
  printKeyValue("authCookieSameSite", readiness?.operations?.authCookieSameSite || "n/a");

  printSection("Checks");
  checks.forEach((check) => {
    console.log(`[${String(check.status || "unknown").toUpperCase()}] ${check.label}: ${check.message}`);
  });

  if (summary.status === "not_ready") {
    process.exitCode = 1;
    return;
  }

  if (summary.status === "ready_with_warnings") {
    process.exitCode = 2;
    return;
  }

  console.log("\nPASS: Deployment readiness checks passed.");
}

run()
  .catch((error) => {
    console.error("Deployment readiness verification failed:", error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDB().catch(() => {});
  });
