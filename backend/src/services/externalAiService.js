const runtime = require("../config/runtime");

const OWNER_ASSISTANT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["statusTone", "headline", "answer", "highlights", "sources", "questionBack"],
  properties: {
    statusTone: {
      type: "string",
      enum: ["success", "warning", "danger", "neutral"],
    },
    headline: {
      type: "string",
      minLength: 1,
      maxLength: 120,
    },
    answer: {
      type: "string",
      minLength: 1,
      maxLength: 1200,
    },
    highlights: {
      type: "array",
      maxItems: 4,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "value"],
        properties: {
          label: {
            type: "string",
            minLength: 1,
            maxLength: 40,
          },
          value: {
            type: "string",
            minLength: 1,
            maxLength: 120,
          },
        },
      },
    },
    sources: {
      type: "array",
      maxItems: 8,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 60,
      },
    },
    questionBack: {
      type: "string",
      minLength: 1,
      maxLength: 180,
    },
  },
};

const EMAIL_REGEX = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_REGEX = /(?:\+?\d[\d\s().-]{6,}\d)/g;
const MAX_HISTORY_ITEMS = 6;
const MAX_STRING_LENGTH = 240;
const MAX_QUESTION_LENGTH = 400;
const MAX_ARRAY_ITEMS = 8;
const MAX_OBJECT_KEYS = 20;
const MAX_DEPTH = 6;
const GENERIC_ALLOWED_SOURCES = new Set([
  "sales",
  "inventory",
  "reports",
  "staff",
  "customers",
  "suppliers",
  "payments",
  "orders",
  "purchase orders",
  "cycle counts",
  "analytics",
  "forecasting",
  "machine learning",
]);

function isConfigured() {
  return Boolean(runtime.externalAssistantEnabled && runtime.openAiApiKey);
}

function sanitizeText(value, maxLength = MAX_STRING_LENGTH) {
  const normalized = String(value || "")
    .replace(/\s+/g, " ")
    .replace(EMAIL_REGEX, "[redacted-email]")
    .replace(PHONE_REGEX, "[redacted-phone]")
    .trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function sanitizeQuestion(question) {
  return sanitizeText(question, MAX_QUESTION_LENGTH);
}

function sanitizeHistory(history = []) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-MAX_HISTORY_ITEMS)
    .map((entry) => ({
      role: String(entry?.role || "").trim().toLowerCase(),
      content: sanitizeText(entry?.content || "", 180),
    }))
    .filter((entry) => ["user", "assistant"].includes(entry.role) && entry.content);
}

function sanitizeStructuredValue(value, depth = 0) {
  if (depth > MAX_DEPTH) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeStructuredValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, MAX_OBJECT_KEYS)
        .map(([key, nestedValue]) => [key, sanitizeStructuredValue(nestedValue, depth + 1)])
        .filter(([, nestedValue]) => nestedValue !== undefined)
    );
  }

  if (typeof value === "string") {
    const sanitized = sanitizeText(value);
    return sanitized || undefined;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? Number(value.toFixed(2)) : undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return undefined;
}

function sanitizeGroundedReply(groundedReply = {}) {
  const safeReply = {
    statusTone: ["success", "warning", "danger", "neutral"].includes(groundedReply?.statusTone)
      ? groundedReply.statusTone
      : "neutral",
    headline: sanitizeText(groundedReply?.headline || "", 120),
    answer: sanitizeText(groundedReply?.answer || "", 1200),
    highlights: Array.isArray(groundedReply?.highlights)
      ? groundedReply.highlights
          .slice(0, 4)
          .map((item) => ({
            label: sanitizeText(item?.label || "", 40),
            value: sanitizeText(item?.value || "", 120),
          }))
          .filter((item) => item.label && item.value)
      : [],
    sources: Array.isArray(groundedReply?.sources)
      ? groundedReply.sources.map((item) => sanitizeText(item || "", 60)).filter(Boolean).slice(0, 8)
      : [],
    questionBack: sanitizeText(groundedReply?.questionBack || "", 180),
  };

  if (!safeReply.headline || !safeReply.answer || !safeReply.questionBack) {
    throw new Error("Grounded reply is not valid for external AI transformation.");
  }

  return safeReply;
}

function sanitizeBusinessSnapshot(snapshot = {}) {
  const sanitized = sanitizeStructuredValue(snapshot, 0);
  return sanitized && typeof sanitized === "object" ? sanitized : {};
}

function buildInstructions() {
  return [
    "You are the owner AI assistant for a retail operations workspace.",
    "Your job is to rewrite the grounded baseline answer for clarity and executive tone, not to create new business facts.",
    "Use only the provided structured business snapshot and the grounded baseline answer.",
    "Do not invent products, suppliers, customers, staff, purchase orders, cycle counts, dates, quantities, revenue, profit, percentages, or risk statements.",
    "If the baseline answer is already clear, keep it close to the baseline.",
    "If the context is insufficient, preserve the baseline answer instead of guessing.",
    "Do not add markdown, bullet numbering, or extra sections outside the schema.",
    "Return valid JSON matching the requested schema.",
  ].join(" ");
}

function buildInput({ question, history = [], businessSnapshot, groundedReply }) {
  const payload = {
    currentQuestion: sanitizeQuestion(question),
    recentConversation: sanitizeHistory(history),
    groundedBaselineAnswer: sanitizeGroundedReply(groundedReply),
    structuredBusinessSnapshot: sanitizeBusinessSnapshot(businessSnapshot),
    task: {
      goal: "Polish the grounded baseline answer without changing the facts.",
      rules: [
        "Do not introduce new factual claims.",
        "Preserve the baseline meaning and operational recommendation.",
        "Keep highlights concise and source labels faithful to the baseline.",
      ],
    },
  };

  return JSON.stringify(payload, null, 2);
}

function extractResponseText(payload = {}) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (payload.output_parsed && typeof payload.output_parsed === "object") {
    return JSON.stringify(payload.output_parsed);
  }

  if (!Array.isArray(payload.output)) {
    return "";
  }

  for (const item of payload.output) {
    if (!Array.isArray(item?.content)) continue;

    for (const contentItem of item.content) {
      if (typeof contentItem?.text === "string" && contentItem.text.trim()) {
        return contentItem.text.trim();
      }
    }
  }

  return "";
}

function normalizeStructuredReply(parsed = {}) {
  const tone = ["success", "warning", "danger", "neutral"].includes(parsed.statusTone)
    ? parsed.statusTone
    : "neutral";

  return {
    statusTone: tone,
    headline: sanitizeText(parsed.headline || "", 120),
    answer: sanitizeText(parsed.answer || "", 1200),
    highlights: Array.isArray(parsed.highlights)
      ? parsed.highlights
          .map((item) => ({
            label: sanitizeText(item?.label || "", 40),
            value: sanitizeText(item?.value || "", 120),
          }))
          .filter((item) => item.label && item.value)
          .slice(0, 4)
      : [],
    sources: Array.isArray(parsed.sources)
      ? parsed.sources.map((item) => sanitizeText(item || "", 60)).filter(Boolean).slice(0, 8)
      : [],
    questionBack: sanitizeText(parsed.questionBack || "", 180),
  };
}

function isValidStructuredReply(reply) {
  return Boolean(
    reply &&
      reply.headline &&
      reply.answer &&
      reply.questionBack &&
      Array.isArray(reply.highlights) &&
      Array.isArray(reply.sources)
  );
}

function collectFactTokensFromText(text = "") {
  const tokens = new Set();
  const patterns = [
    /\b(?:SALE|PO|CC)-\d+\b/gi,
    /\bSKU-[A-Z0-9-]+\b/gi,
    /\b(?:USD|CAD)\s*\d[\d,]*(?:\.\d+)?\b/gi,
    /\b\d[\d,]*(?:\.\d+)?%\b/g,
    /\b\d(?:\.\d+)?\s+days?\b/gi,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b\d{2,}(?:,\d{3})*(?:\.\d+)?\b/g,
  ];

  patterns.forEach((pattern) => {
    const matches = String(text || "").match(pattern) || [];
    matches.forEach((match) => tokens.add(String(match).replace(/\s+/g, " ").trim().toUpperCase()));
  });

  return tokens;
}

function collectFactTokens(value) {
  return collectFactTokensFromText(JSON.stringify(value || {}));
}

function findUnsupportedFactTokens(reply, groundedReply, businessSnapshot) {
  const allowedTokens = new Set([
    ...collectFactTokens(groundedReply),
    ...collectFactTokens(businessSnapshot),
  ]);
  const replyTokens = collectFactTokens({
    headline: reply.headline,
    answer: reply.answer,
    highlights: reply.highlights,
    questionBack: reply.questionBack,
  });

  return [...replyTokens].filter((token) => !allowedTokens.has(token));
}

function sanitizeSources(sources = [], groundedReply = {}) {
  const allowedSources = new Set([
    ...GENERIC_ALLOWED_SOURCES,
    ...(Array.isArray(groundedReply?.sources) ? groundedReply.sources : []).map((item) =>
      String(item || "").trim().toLowerCase()
    ),
  ]);

  return sources
    .map((item) => sanitizeText(item || "", 60))
    .filter((item) => item && allowedSources.has(item.toLowerCase()))
    .slice(0, 8);
}

async function generateOwnerAssistantReply({
  question,
  history = [],
  businessSnapshot,
  groundedReply,
}) {
  if (!isConfigured()) {
    return null;
  }

  const safeGroundedReply = sanitizeGroundedReply(groundedReply);
  const safeBusinessSnapshot = sanitizeBusinessSnapshot(businessSnapshot);
  const endpoint = `${runtime.openAiBaseUrl.replace(/\/+$/, "")}/responses`;
  const response = await fetch(endpoint, {
    method: "POST",
    signal: AbortSignal.timeout(runtime.openAiTimeoutMs),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${runtime.openAiApiKey}`,
    },
    body: JSON.stringify({
      model: runtime.openAiModel,
      store: false,
      instructions: buildInstructions(),
      input: buildInput({
        question,
        history,
        businessSnapshot: safeBusinessSnapshot,
        groundedReply: safeGroundedReply,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "owner_assistant_reply",
          strict: true,
          schema: OWNER_ASSISTANT_SCHEMA,
        },
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      payload?.error?.message || `OpenAI request failed with status ${response.status}.`;
    throw new Error(message);
  }

  const text = extractResponseText(payload);
  if (!text) {
    throw new Error("OpenAI response did not contain structured text.");
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("OpenAI response did not contain valid JSON.");
  }

  const normalizedReply = normalizeStructuredReply(parsed);
  if (!isValidStructuredReply(normalizedReply)) {
    throw new Error("OpenAI response did not satisfy the expected assistant schema.");
  }

  normalizedReply.sources = sanitizeSources(normalizedReply.sources, safeGroundedReply);

  const unsupportedTokens = findUnsupportedFactTokens(
    normalizedReply,
    safeGroundedReply,
    safeBusinessSnapshot
  );

  if (unsupportedTokens.length > 0) {
    throw new Error(
      `OpenAI response introduced unsupported factual tokens: ${unsupportedTokens.join(", ")}`
    );
  }

  return normalizedReply;
}

module.exports = {
  isConfigured,
  generateOwnerAssistantReply,
};
