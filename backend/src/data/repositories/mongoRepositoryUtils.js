const { mongoose } = require("../../config/db");
const runtime = require("../../config/runtime");
const models = require("../models");

function safeDate(value) {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function currentIsoTimestamp() {
  return new Date().toISOString();
}

function toIsoTimestamp(value, fallback = null) {
  const parsed = safeDate(value);
  if (parsed) {
    return parsed.toISOString();
  }

  if (fallback === null || fallback === undefined) {
    return currentIsoTimestamp();
  }

  const fallbackParsed = safeDate(fallback);
  return fallbackParsed ? fallbackParsed.toISOString() : currentIsoTimestamp();
}

function toNullableIsoTimestamp(value, fallback = null) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = safeDate(value);
  return parsed ? parsed.toISOString() : fallback;
}

function compactLookupText(value, fallback = "") {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || String(fallback || "").trim();
}

function lookupKey(value) {
  return compactLookupText(value).toLowerCase();
}

function buildExactCaseInsensitiveRegex(value) {
  const escaped = String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped}$`, "i");
}

function parseNumericFromId(value, fallback = 0) {
  const parsed = Number(String(value || "").replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cloneValue(value) {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value));
}

function applySessionToQuery(query, session) {
  return session ? query.session(session) : query;
}

function supportsTransactionsInRuntime() {
  return mongoose.connection.readyState === 1;
}

function isTransactionUnsupportedError(error) {
  const message = String(error?.message || "");

  return (
    /Transaction numbers are only allowed on a replica set member or mongos/i.test(message) ||
    /replica set/i.test(message) ||
    /Transaction .* not supported/i.test(message)
  );
}

async function withOptionalTransaction(operation) {
  if (!supportsTransactionsInRuntime()) {
    return operation({ session: null });
  }

  const session = await mongoose.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      result = await operation({ session });
    });

    return result;
  } catch (error) {
    if (runtime.isDevelopment && isTransactionUnsupportedError(error)) {
      console.warn(
        "Mongo transactions are unavailable on the current development deployment. Continuing without a transaction."
      );
      return operation({ session: null });
    }

    throw error;
  } finally {
    await session.endSession();
  }
}

async function nextSequence(key, { session = null } = {}) {
  const now = new Date();
  const counter = await applySessionToQuery(
    models.Counter.findOneAndUpdate(
      { key },
      {
        $inc: { seq: 1 },
        $set: { updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      {
        upsert: true,
        new: true,
      }
    ),
    session
  ).lean();

  return Number(counter?.seq || 1);
}

async function ensureCounterAtLeast(key, seq, { session = null } = {}) {
  const normalizedSeq = Number(seq);
  if (!Number.isFinite(normalizedSeq) || normalizedSeq <= 0) {
    return;
  }

  const now = new Date();
  await applySessionToQuery(
    models.Counter.updateOne(
      { key },
      {
        $max: { seq: normalizedSeq },
        $set: { updatedAt: now },
        $setOnInsert: { createdAt: now },
      },
      { upsert: true }
    ),
    session
  );
}

module.exports = {
  applySessionToQuery,
  buildExactCaseInsensitiveRegex,
  compactLookupText,
  cloneValue,
  currentIsoTimestamp,
  ensureCounterAtLeast,
  lookupKey,
  nextSequence,
  parseNumericFromId,
  safeDate,
  toIsoTimestamp,
  toNullableIsoTimestamp,
  withOptionalTransaction,
};
