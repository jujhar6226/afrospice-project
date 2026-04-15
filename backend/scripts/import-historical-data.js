require("../src/config/loadEnv");

const path = require("path");

const { connectDB, disconnectDB } = require("../src/config/db");
const { importHistoricalData } = require("../src/import/historicalImportService");

function parseArgs(argv = []) {
  const args = {
    manifestPath: "",
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--manifest") {
      args.manifestPath = String(argv[index + 1] || "").trim();
      index += 1;
      continue;
    }

    if (value === "--dry-run") {
      args.dryRun = true;
    }
  }

  return args;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.manifestPath) {
    throw new Error("Usage: node ./scripts/import-historical-data.js --manifest <path> [--dry-run]");
  }

  await connectDB();
  try {
    const result = await importHistoricalData({
      manifestPath: path.resolve(process.cwd(), options.manifestPath),
      dryRun: options.dryRun,
    });
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await disconnectDB();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
