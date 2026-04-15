const analyticsService = require("./analyticsService");
const runtime = require("../config/runtime");
const externalAiService = require("./externalAiService");
const machineLearningService = require("./machineLearningService");

function normalizeCurrency(currency) {
  const code = String(currency || "CAD").trim().toUpperCase();
  return code === "USD" ? "CAD" : code || "CAD";
}

function formatMoney(value, currency = "CAD") {
  const code = normalizeCurrency(currency);
  const locale = code === "CAD" ? "en-CA" : "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: code,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

function getStatusDescriptor(value) {
  if (value === "danger") return "Needs Action";
  if (value === "warning") return "Watch Closely";
  return "Stable";
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No recent date";

  return date.toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function includesAny(text, terms = []) {
  return terms.some((term) => text.includes(term));
}

function sanitizeHistory(history = []) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-8)
    .map((entry) => ({
      role: String(entry?.role || "").trim().toLowerCase(),
      content: String(entry?.content || "").trim(),
    }))
    .filter((entry) => entry.role && entry.content);
}

function getHistoryText(history = []) {
  return sanitizeHistory(history)
    .map((entry) => normalizeText(entry.content))
    .join(" ");
}

function buildContextQuery(question, history = []) {
  const direct = normalizeText(question);
  const historyText = getHistoryText(history);
  return {
    direct,
    combined: [direct, historyText].filter(Boolean).join(" ").trim(),
  };
}

function tokenizeText(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function isGreeting(query = "") {
  return /^(hi|hello|hey|good morning|good afternoon|good evening)\b/.test(query);
}

function isThanks(query = "") {
  return /^(thanks|thank you|appreciate it)\b/.test(query);
}

function isCapabilityQuestion(query = "") {
  return includesAny(query, [
    "help",
    "what can you do",
    "how do i use you",
    "who are you",
    "what do you do",
    "how can you help",
  ]);
}

function isGeneralBusinessIntent(query = "") {
  return includesAny(query, [
    "summary",
    "overview",
    "overall",
    "how much did we",
    "how much did i",
    "how are things",
    "what needs attention",
    "what should i do",
    "what matters most",
    "biggest risk",
    "key risk",
    "cash risk",
    "where is cash leaking",
    "revenue at risk",
    "money stuck",
    "priority",
    "priorities",
    "how are we doing",
    "how is the business",
    "business health",
    "store health",
    "what is going on",
    "what's going on",
    "where should i focus",
    "where do i start",
    "what should i reorder",
    "what should i restock",
    "what should i buy",
    "what should i protect",
    "what should i push",
    "what should i promote",
    "status",
    "today",
    "yesterday",
    "this week",
    "this month",
    "last week",
    "last month",
  ]);
}

function isContextualFollowUp(query = "") {
  return (
    includesAny(query, [
      "what about",
      "how about",
      "go deeper",
      "more detail",
      "drill into",
      "drill in",
      "compare that",
      "compare it",
      "same for",
      "and that",
      "and what about",
    ]) ||
    /^(why|how|compare|deeper|more|show|explain|break that down)\b/.test(query)
  );
}

function isAffirmativeFollowUp(query = "") {
  return /^(yes|yeah|yep|sure|ok|okay|yes please|sure thing|go ahead|do it|that one|sounds good)\b/.test(
    query
  );
}

function isNegativeFollowUp(query = "") {
  return /^(no|nope|nah|not now|maybe later|skip it)\b/.test(query);
}

function extractLastAssistantQuestion(history = []) {
  const lastAssistant = [...sanitizeHistory(history)]
    .reverse()
    .find((entry) => entry.role === "assistant" && entry.content);

  if (!lastAssistant?.content) return "";

  const matches = lastAssistant.content.match(
    /(?:assistant asks:\s*)?(do you want(?: me)? to [^?]+\?|do you want [^?]+\?|would you like(?: me)? to [^?]+\?|would you like [^?]+\?|what do you want[^?]+\?)/gi
  );

  return matches?.[matches.length - 1]?.trim() || "";
}

function resolveAssistantPrompt(prompt = "") {
  const raw = String(prompt || "")
    .trim()
    .replace(/^assistant asks:\s*/i, "")
    .replace(/^for example,\s*/i, "")
    .trim();

  if (!raw) return null;

  const cleaned = raw
    .replace(/^do you want me to\s+/i, "")
    .replace(/^would you like me to\s+/i, "")
    .replace(/^do you want to\s+/i, "")
    .replace(/^would you like to\s+/i, "")
    .replace(/[?]+$/g, "")
    .trim();

  if (!cleaned) return null;

  const looksDirective = /^(compare|connect|break|check|identify|list|show|suggest|tell|use|open|drill)\b/i.test(
    cleaned
  );
  const looksLikeChoiceList = /,\s*|\s+or\s+/i.test(cleaned);

  if (looksLikeChoiceList && !looksDirective) {
    return {
      kind: "choice-list",
      options: buildFollowUps(raw),
    };
  }

  return {
    kind: "question",
    question: capitalizePrompt(cleaned),
  };
}

function resolveShortFollowUp(question, history = []) {
  const direct = normalizeText(question);

  if (isNegativeFollowUp(direct)) {
    return {
      kind: "reply",
      reply: buildAssistantPayload({
        headline: "Okay",
        answer: "Understood. Ask the next business question whenever you want.",
        questionBack: "What do you want to check next?",
        sources: [],
      }),
    };
  }

  if (!isAffirmativeFollowUp(direct)) {
    return null;
  }

  const lastQuestion = extractLastAssistantQuestion(history);
  if (!lastQuestion) return null;

  const resolvedPrompt = resolveAssistantPrompt(lastQuestion);
  if (!resolvedPrompt) return null;

  if (resolvedPrompt.kind === "choice-list") {
    return {
      kind: "reply",
      reply: buildAssistantPayload({
        statusTone: "warning",
        headline: "Pick one direction",
        answer: "Say which path you want, not just yes.",
        followUps: resolvedPrompt.options,
        questionBack: "Which one do you want me to open first?",
        sources: [],
      }),
    };
  }

  return {
    kind: "question",
    question: resolvedPrompt.question,
  };
}

const MATCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "by",
  "do",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "show",
  "tell",
  "that",
  "the",
  "this",
  "to",
  "what",
  "which",
  "who",
  "with",
  "yesterday",
  "today",
  "week",
  "month",
  "year",
]);

function tokenizeForMatch(value) {
  return tokenizeText(value).filter((token) => !MATCH_STOP_WORDS.has(token));
}

function getDatasetAnchorDate(data) {
  const latestSale = [...(data?.sales || [])]
    .map((sale) => sale?.dateObj)
    .filter(Boolean)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  return latestSale ? new Date(latestSale) : new Date();
}

function cloneDate(value) {
  return new Date(value.getTime());
}

function startOfDay(value) {
  const date = cloneDate(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function endOfDay(value) {
  const date = cloneDate(value);
  date.setHours(23, 59, 59, 999);
  return date;
}

function addDays(value, days) {
  const date = cloneDate(value);
  date.setDate(date.getDate() + days);
  return date;
}

function startOfWeek(value) {
  const date = startOfDay(value);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return date;
}

function endOfWeek(value) {
  return endOfDay(addDays(startOfWeek(value), 6));
}

function startOfMonth(value) {
  return new Date(value.getFullYear(), value.getMonth(), 1, 0, 0, 0, 0);
}

function endOfMonth(value) {
  return new Date(value.getFullYear(), value.getMonth() + 1, 0, 23, 59, 59, 999);
}

function startOfYear(value) {
  return new Date(value.getFullYear(), 0, 1, 0, 0, 0, 0);
}

function endOfYear(value) {
  return new Date(value.getFullYear(), 11, 31, 23, 59, 59, 999);
}

function addMonths(value, months) {
  return new Date(value.getFullYear(), value.getMonth() + months, 1, value.getHours(), value.getMinutes(), value.getSeconds(), value.getMilliseconds());
}

function formatDateRange(start, end) {
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  if (sameDay) {
    return formatDate(start);
  }

  return `${formatDate(start)} to ${formatDate(end)}`;
}

function getTimeScope(question, data) {
  const query = normalizeText(question);
  const anchor = getDatasetAnchorDate(data);

  if (includesAny(query, ["today", "for today"])) {
    const start = startOfDay(anchor);
    const end = endOfDay(anchor);
    return { key: "today", label: "today", start, end, rangeLabel: formatDateRange(start, end) };
  }

  if (includesAny(query, ["yesterday", "for yesterday"])) {
    const day = addDays(anchor, -1);
    const start = startOfDay(day);
    const end = endOfDay(day);
    return { key: "yesterday", label: "yesterday", start, end, rangeLabel: formatDateRange(start, end) };
  }

  if (includesAny(query, ["this week", "current week"])) {
    const start = startOfWeek(anchor);
    const end = endOfWeek(anchor);
    return { key: "this-week", label: "this week", start, end, rangeLabel: formatDateRange(start, end) };
  }

  if (includesAny(query, ["last week", "previous week"])) {
    const previousWeek = addDays(startOfWeek(anchor), -7);
    const start = startOfWeek(previousWeek);
    const end = endOfWeek(previousWeek);
    return { key: "last-week", label: "last week", start, end, rangeLabel: formatDateRange(start, end) };
  }

  if (includesAny(query, ["this month", "current month"])) {
    const start = startOfMonth(anchor);
    const end = endOfMonth(anchor);
    return { key: "this-month", label: "this month", start, end, rangeLabel: formatDateRange(start, end) };
  }

  if (includesAny(query, ["last month", "previous month"])) {
    const previousMonth = addMonths(anchor, -1);
    const start = startOfMonth(previousMonth);
    const end = endOfMonth(previousMonth);
    return { key: "last-month", label: "last month", start, end, rangeLabel: formatDateRange(start, end) };
  }

  if (includesAny(query, ["this year", "current year"])) {
    const start = startOfYear(anchor);
    const end = endOfYear(anchor);
    return { key: "this-year", label: "this year", start, end, rangeLabel: formatDateRange(start, end) };
  }

  if (includesAny(query, ["last year", "previous year"])) {
    const previousYear = new Date(anchor.getFullYear() - 1, 0, 1);
    const start = startOfYear(previousYear);
    const end = endOfYear(previousYear);
    return { key: "last-year", label: "last year", start, end, rangeLabel: formatDateRange(start, end) };
  }

  return null;
}

function getSalesInTimeScope(data, scope) {
  if (!scope) return data.sales || [];

  return (data.sales || []).filter((sale) => {
    const time = sale?.dateObj?.getTime?.();
    if (!Number.isFinite(time)) return false;
    return time >= scope.start.getTime() && time <= scope.end.getTime();
  });
}

function buildSalesSnapshot(sales, products = []) {
  const productMap = products.reduce((accumulator, product) => {
    accumulator[Number(product.id)] = product;
    return accumulator;
  }, {});

  const productRevenue = {};
  const categoryRevenue = {};
  const cashierRevenue = {};

  let totalRevenue = 0;
  let orders = 0;
  let paidOrders = 0;
  let pendingOrders = 0;
  let declinedOrders = 0;
  let recognizedProfit = 0;
  let costBackedRevenue = 0;
  let uncostedRevenue = 0;

  sales.forEach((sale) => {
    totalRevenue += Number(sale.total || 0);
    orders += 1;

    if (sale.status === "Paid") paidOrders += 1;
    else if (sale.status === "Declined") declinedOrders += 1;
    else pendingOrders += 1;

    const cashier = String(sale.cashier || "Front Desk").trim() || "Front Desk";
    if (!cashierRevenue[cashier]) {
      cashierRevenue[cashier] = { cashier, revenue: 0, orders: 0 };
    }
    cashierRevenue[cashier].revenue += Number(sale.total || 0);
    cashierRevenue[cashier].orders += 1;

    (sale.items || []).forEach((item) => {
      const product = productMap[Number(item.id)] || {};
      const productName = String(item.name || product.name || "Unknown Product").trim() || "Unknown Product";
      const category = String(product.category || "General").trim() || "General";
      const qty = Number(item.qty || 0);
      const revenue = qty * Number(item.price || 0);
      const unitCost = Number(item.unitCost || 0);
      const lineCost = qty * unitCost;

      if (!productRevenue[productName]) {
        productRevenue[productName] = {
          name: productName,
          id: Number(item.id || product.id || 0),
          category,
          supplier: String(product.supplier || "").trim(),
          unitsSold: 0,
          revenue: 0,
        };
      }

      productRevenue[productName].unitsSold += qty;
      productRevenue[productName].revenue += revenue;

      if (!categoryRevenue[category]) {
        categoryRevenue[category] = { name: category, revenue: 0 };
      }
      categoryRevenue[category].revenue += revenue;

      if (unitCost > 0) {
        recognizedProfit += revenue - lineCost;
        costBackedRevenue += revenue;
      } else {
        uncostedRevenue += revenue;
      }
    });
  });

  return {
    totalRevenue,
    orders,
    paidOrders,
    pendingOrders,
    declinedOrders,
    averageOrderValue: orders ? totalRevenue / orders : 0,
    paidRate: orders ? (paidOrders / orders) * 100 : 0,
    recognizedProfit,
    costBackedRevenue,
    uncostedRevenue,
    profitCoverageRate: totalRevenue > 0 ? (costBackedRevenue / totalRevenue) * 100 : 100,
    topProduct:
      Object.values(productRevenue).sort((a, b) => b.revenue - a.revenue || b.unitsSold - a.unitsSold)[0] ||
      null,
    topCategory: Object.values(categoryRevenue).sort((a, b) => b.revenue - a.revenue)[0] || null,
    topCashier: Object.values(cashierRevenue)
      .map((entry) => ({
        ...entry,
        averageOrderValue: entry.orders ? entry.revenue / entry.orders : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)[0] || null,
    productRevenue,
    categoryRevenue,
  };
}

function buildProductTimeSnapshot(productName, sales, products = []) {
  if (!productName) return null;
  const normalizedName = normalizeText(productName);
  const product = products.find((item) => normalizeText(item.name) === normalizedName) || null;

  const summary = sales.reduce(
    (accumulator, sale) => {
      (sale.items || []).forEach((item) => {
        const candidateName = normalizeText(item.name || product?.name);
        if (candidateName !== normalizedName) return;
        accumulator.unitsSold += Number(item.qty || 0);
        accumulator.revenue += Number(item.qty || 0) * Number(item.price || 0);
        if (!accumulator.lastSoldAt || sale.dateObj > accumulator.lastSoldAt) {
          accumulator.lastSoldAt = sale.dateObj;
        }
      });
      return accumulator;
    },
    { unitsSold: 0, revenue: 0, lastSoldAt: null }
  );

  return {
    name: product?.name || productName,
    stock: Number(product?.stock || 0),
    supplier: String(product?.supplier || "General Supplier").trim() || "General Supplier",
    category: String(product?.category || "General").trim() || "General",
    ...summary,
  };
}

function buildCategoryTimeSnapshot(categoryName, sales, products = []) {
  if (!categoryName) return null;
  const normalizedCategory = normalizeText(categoryName);
  const productMap = products.reduce((accumulator, product) => {
    accumulator[Number(product.id)] = product;
    return accumulator;
  }, {});

  const summary = sales.reduce(
    (accumulator, sale) => {
      (sale.items || []).forEach((item) => {
        const product = productMap[Number(item.id)] || null;
        const category = normalizeText(product?.category || "general");
        if (category !== normalizedCategory) return;

        const revenue = Number(item.qty || 0) * Number(item.price || 0);
        accumulator.revenue += revenue;
        accumulator.unitsSold += Number(item.qty || 0);
      });
      return accumulator;
    },
    { revenue: 0, unitsSold: 0 }
  );

  return {
    name: categoryName,
    ...summary,
  };
}

function scoreCandidate(queryText, queryTokens, candidateText) {
  const normalizedCandidate = normalizeText(candidateText);
  if (!normalizedCandidate) return 0;

  const candidateTokens = tokenizeForMatch(normalizedCandidate);
  let score = 0;

  if (queryText === normalizedCandidate) {
    score = Math.max(score, 140);
  }

  if (queryText.includes(normalizedCandidate) && normalizedCandidate.length >= 3) {
    score = Math.max(score, 120);
  }

  if (normalizedCandidate.includes(queryText) && queryText.length >= 4) {
    score = Math.max(score, 108);
  }

  const overlap = candidateTokens.filter((token) => queryTokens.includes(token));
  if (overlap.length) {
    const ratio = overlap.length / Math.max(candidateTokens.length, 1);
    score = Math.max(score, 70 + overlap.length * 12 + Math.round(ratio * 20));
  }

  if (
    queryTokens.length === 1 &&
    candidateTokens.some(
      (token) => token.startsWith(queryTokens[0]) || queryTokens[0].startsWith(token)
    )
  ) {
    score = Math.max(score, 88);
  }

  return score;
}

function resolveEntityMatch(question, history, items, getCandidates, minimumScore = 88) {
  const { direct, combined } = buildContextQuery(question, history);
  const directTokens = tokenizeForMatch(direct);
  const combinedTokens = tokenizeForMatch(combined);

  let best = null;

  items.forEach((item) => {
    const candidates = getCandidates(item).filter(Boolean);
    let score = 0;

    candidates.forEach((candidate) => {
      score = Math.max(score, scoreCandidate(direct, directTokens, candidate));
      score = Math.max(score, Math.max(0, scoreCandidate(combined, combinedTokens, candidate) - 18));
    });

    if (!best || score > best.score) {
      best = { item, score };
    }
  });

  return best && best.score >= minimumScore ? best.item : null;
}

function buildProductInsights(products, sales) {
  const productMap = products.reduce((accumulator, product) => {
    accumulator[Number(product.id)] = {
      id: Number(product.id),
      name: String(product.name || "Unknown Product").trim(),
      category: String(product.category || "General").trim() || "General",
      supplier: String(product.supplier || "General Supplier").trim() || "General Supplier",
      stock: Number(product.stock || 0),
      price: Number(product.price || 0),
      unitsSold: 0,
      revenue: 0,
      lastSoldAt: null,
    };
    return accumulator;
  }, {});

  sales.forEach((sale) => {
    sale.items.forEach((item) => {
      const product = productMap[Number(item.id)];
      if (!product) return;

      const qty = Number(item.qty || 0);
      const lineRevenue = qty * Number(item.price || 0);

      product.unitsSold += qty;
      product.revenue += lineRevenue;

      if (!product.lastSoldAt || new Date(sale.date) > new Date(product.lastSoldAt)) {
        product.lastSoldAt = sale.date;
      }
    });
  });

  return Object.values(productMap);
}

function summarizePurchaseOrders(orders) {
  const draft = orders.filter((order) => String(order.status) === "Draft");
  const sent = orders.filter((order) => String(order.status) === "Sent");
  const received = orders.filter((order) => String(order.status) === "Received");

  return {
    total: orders.length,
    draft,
    sent,
    received,
    draftCount: draft.length,
    sentCount: sent.length,
    receivedCount: received.length,
    topOpenSupplier:
      [...orders]
        .filter((order) => ["Draft", "Sent"].includes(String(order.status)))
        .sort((a, b) => Number(b.totalEstimatedCost || 0) - Number(a.totalEstimatedCost || 0))[0] ||
      null,
  };
}

function summarizeCycleCounts(counts) {
  const open = counts.filter((count) => String(count.status) === "Open");
  const completed = counts.filter((count) => String(count.status) === "Completed");
  const latestCompleted =
    [...completed].sort(
      (a, b) => new Date(b.completedAt || b.createdAt || 0) - new Date(a.completedAt || a.createdAt || 0)
    )[0] || null;

  return {
    total: counts.length,
    open,
    completed,
    openCount: open.length,
    completedCount: completed.length,
    latestCompleted,
  };
}

function getInventoryHealthScore(inventoryIntel, lowStockCount) {
  const criticalCount = (inventoryIntel?.reorderNow || []).filter(
    (item) => Number(item.stock || 0) <= 5
  ).length;
  const dormantCount = Number(inventoryIntel?.summary?.dormantStockCount || 0);

  return Math.min(
    98,
    Math.max(24, Math.round(100 - criticalCount * 9 - lowStockCount * 3 - dormantCount * 2))
  );
}

async function getBaseDataset() {
  const context = await analyticsService.getAnalyticsContextAsync();
  const overview = analyticsService.getOverviewMetrics(context);
  const inventorySignals = analyticsService.getInventorySignals(context);
  const rawInventoryIntel = analyticsService.getInventoryIntelligence(context);
  const rawReports = analyticsService.getReportsDataset("monthly", context);
  const customersIntel = analyticsService.getCustomersDataset("monthly", context);
  const suppliersIntel = analyticsService.getSuppliersDataset("monthly", context);
  const dashboardDecisionModel = analyticsService.getDashboardDecisionModel(context);
  const sales = analyticsService.getNormalizedSales(context);
  const topCashiers = analyticsService.getTopCashiers(5, context);
  const paymentMethodBreakdown = analyticsService.getPaymentMethodBreakdown(context);
  const channelBreakdown = analyticsService.getChannelBreakdown(context);
  const daypartPerformance = analyticsService.getDaypartPerformance(context);
  const allUsers = context.users;
  const products = context.products;
  const purchaseOrders = context.purchaseOrders;
  const cycleCounts = context.cycleCounts;
  const recentMovements = context.inventoryMovements.slice(0, 6);
  const activeUsers = allUsers.filter((user) => String(user.status) === "Active");
  const managers = activeUsers.filter((user) => String(user.role) === "Manager");
  const cashiers = activeUsers.filter((user) => String(user.role) === "Cashier");
  const clerks = activeUsers.filter((user) => String(user.role) === "Inventory Clerk");
  const productInsights = buildProductInsights(products, sales);
  const purchaseOrderSummary = summarizePurchaseOrders(purchaseOrders);
  const cycleCountSummary = summarizeCycleCounts(cycleCounts);
  const topPaymentMethod = paymentMethodBreakdown[0] || null;
  const topChannel = channelBreakdown[0] || null;
  const bestTradingWindow =
    [...daypartPerformance].sort((a, b) => Number(b.revenue || 0) - Number(a.revenue || 0))[0] || null;
  const normalizedSupplierWatch = (rawInventoryIntel.supplierWatch || []).map((item) => ({
    ...item,
    atRiskProducts: Number(item.exposedSkuCount || item.lowStockLines || 0),
    urgencyScore: Number(item.topExposure?.urgencyScore || 0) + Number(item.exposedRevenue || 0) / 100,
  }));
  const inventoryIntel = {
    ...rawInventoryIntel,
    summary: {
      ...rawInventoryIntel.summary,
      atRiskInventoryValue: Number(rawInventoryIntel.summary?.exposedStockValue || 0),
    },
    supplierWatch: normalizedSupplierWatch,
  };
  const topRisk =
    [...inventoryIntel.reorderNow].sort((a, b) => {
      const aImmediate = Number(a.stock || 0) <= 10 ? 0 : 1;
      const bImmediate = Number(b.stock || 0) <= 10 ? 0 : 1;

      if (aImmediate !== bImmediate) {
        return aImmediate - bImmediate;
      }

      const aCover = Number.isFinite(Number(a.estimatedDaysCover))
        ? Number(a.estimatedDaysCover)
        : 9999;
      const bCover = Number.isFinite(Number(b.estimatedDaysCover))
        ? Number(b.estimatedDaysCover)
        : 9999;

      if (aCover !== bCover) {
        return aCover - bCover;
      }

      return Number(b.urgencyScore || 0) - Number(a.urgencyScore || 0);
    })[0] || null;
  const supplierLead = inventoryIntel.supplierWatch[0] || null;
  const dormantLead = inventoryIntel.dormantStock[0] || null;
  const topCategory = rawReports.categoryBreakdown[0] || null;
  const topProduct = rawReports.topProducts[0] || null;
  const topCashier = topCashiers[0] || null;
  const healthScore = getInventoryHealthScore(inventoryIntel, inventorySignals.lowStockCount);
  const machineForecast = machineLearningService.getOperationalModelOutputs(
    {
      range: "daily",
      horizon: 14,
      limit: 6,
    },
    context
  );
  const reports = {
    ...rawReports,
    summary: {
      ...rawReports.summary,
      topCategory: topCategory?.name || null,
      topProduct: topProduct?.name || null,
    },
  };

  return {
    overview,
    inventorySignals,
    inventoryIntel,
    reports,
    customersIntel,
    suppliersIntel,
    sales,
    topCashiers,
    paymentMethodBreakdown,
    channelBreakdown,
    daypartPerformance,
    topPaymentMethod,
    topChannel,
    bestTradingWindow,
    allUsers,
    products,
    purchaseOrders,
    purchaseOrderSummary,
    cycleCounts,
    cycleCountSummary,
    recentMovements,
    activeUsers,
    managers,
    cashiers,
    clerks,
    productInsights,
    topRisk,
    supplierLead,
    dormantLead,
    topCategory,
    topProduct,
    topCashier,
    healthScore,
    dashboardDecisionModel,
    machineForecast,
  };
}

function buildAiSignalBundle(data) {
  return {
    dailyBriefing: data.dashboardDecisionModel?.dailyBriefing || null,
    restockSuggestions: (
      data.machineForecast?.restockRecommendations?.length
        ? data.machineForecast.restockRecommendations
        : data.inventoryIntel?.reorderNow || []
    )
      .slice(0, 5)
      .map((item) => ({
      name: item.name,
      supplier: item.supplier,
      stock: Number(item.currentStock || item.stock || 0),
      estimatedDaysCover:
        item.daysCover === null ||
        item.daysCover === undefined ||
        item.daysCover === ""
          ? null
          : Number(item.daysCover || item.estimatedDaysCover),
      status: item.riskLevel || item.status || "Watch",
      recentRevenue: Number(item.forecastRevenue || item.recentRevenue || item.revenue || 0),
      recommendedOrderQty: Number(item.recommendedOrderQty || 0),
      confidenceScore: Number(item.confidenceScore || 0),
    })),
    riskAlerts: data.dashboardDecisionModel?.smartAlerts || [],
    salesInsights: data.reports?.insights || [],
    demandForecast: data.machineForecast?.overview || null,
    anomalyAlerts: data.machineForecast?.anomalyAlerts || [],
  };
}

function detectAiSignalIntent(query = "") {
  if (!query) return null;

  if (includesAny(query, ["daily briefing", "morning briefing", "owner briefing", "brief me"])) {
    return "daily-briefing";
  }

  if (
    includesAny(query, [
      "restock suggestions",
      "restock suggestion",
      "reorder suggestions",
      "reorder suggestion",
      "restock list",
      "reorder list",
    ])
  ) {
    return "restock-suggestions";
  }

  if (includesAny(query, ["risk alerts", "risk alert", "smart alerts", "smart alert"])) {
    return "risk-alerts";
  }

  if (
    includesAny(query, [
      "anomaly",
      "anomalies",
      "unusual pattern",
      "unusual patterns",
      "odd pattern",
      "weird pattern",
      "anything unusual",
      "abnormal",
      "outlier",
      "outliers",
    ])
  ) {
    return "anomaly-alerts";
  }

  if (
    includesAny(query, [
      "dataset",
      "data set",
      "what data is the model using",
      "what is the model using",
      "what is the ml using",
      "model foundation",
      "training data",
      "what does the model train on",
      "what powers the model",
    ])
  ) {
    return "model-foundation";
  }

  if (
    includesAny(query, [
      "uncertainty",
      "forecast range",
      "confidence band",
      "upper bound",
      "lower bound",
      "interval",
      "how wide is the forecast",
      "how wide is the range",
    ])
  ) {
    return "forecast-uncertainty";
  }

  if (
    includesAny(query, [
      "forecast",
      "projection",
      "projected revenue",
      "next week",
      "next month",
      "demand model",
      "predict",
      "prediction",
    ])
  ) {
    return "demand-forecast";
  }

  if (
    includesAny(query, [
      "confidence",
      "how reliable",
      "reliable is the model",
      "trust the model",
      "accuracy",
      "error rate",
      "wape",
      "model quality",
    ])
  ) {
    return "model-confidence";
  }

  if (
    includesAny(query, [
      "stockout",
      "stock out",
      "stockout probability",
      "probability of stockout",
      "chance of stockout",
      "likelihood of stockout",
      "chance of running out",
      "run out",
      "which sku will break",
      "which products will break",
      "which products are at risk",
      "inventory risk from the model",
      "replenishment risk",
    ])
  ) {
    return "stockout-risk";
  }

  if (
    includesAny(query, [
      "lead time",
      "lead-time",
      "supplier delay",
      "supplier delays",
      "delay risk",
      "delivery lag",
      "replenishment window",
      "purchase order delay",
    ])
  ) {
    return "lead-time-pressure";
  }

  if (
    includesAny(query, [
      "opportunity",
      "what should i push",
      "what should i promote",
      "promotion candidate",
      "growth opportunity",
      "which sku can we push",
    ])
  ) {
    return "promotion-opportunities";
  }

  if (includesAny(query, ["sales insights", "sales insight"])) {
    return "sales-insights";
  }

  return null;
}

function findMentionedProduct(question, data, history = []) {
  return resolveEntityMatch(
    question,
    history,
    data.productInsights,
    (product) => [product.name, product.sku, product.category, product.supplier]
  );
}

function findMentionedCategory(question, data, history = []) {
  const categories = [
    ...new Set(
      [
        ...data.reports.categoryBreakdown.map((item) => item.name),
        ...data.products.map((product) => product.category),
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    ),
  ].map((name) => ({ name }));

  return resolveEntityMatch(question, history, categories, (item) => [item.name], 84);
}

function findMentionedCashier(question, data, history = []) {
  const cashiers = [
    ...new Set(
      [...data.topCashiers.map((item) => item.cashier), ...data.sales.map((sale) => sale.cashier)]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    ),
  ].map((cashier) => {
    const matched = data.topCashiers.find((item) => normalizeText(item.cashier) === normalizeText(cashier));
    return matched || { cashier, revenue: 0, orders: 0, averageOrderValue: 0 };
  });

  return resolveEntityMatch(question, history, cashiers, (item) => [item.cashier], 84);
}

function findMentionedCustomer(question, data, history = []) {
  const customers = Array.isArray(data.customersIntel?.customers)
    ? data.customersIntel.customers
    : [];

  return resolveEntityMatch(question, history, customers, (item) => [item.customer], 84);
}

function findMentionedSupplier(question, data, history = []) {
  const suppliers = [
    ...new Set(
      [
        ...data.products.map((product) => String(product.supplier || "").trim()),
        ...data.purchaseOrders.map((order) => String(order.supplier || "").trim()),
      ].filter(Boolean)
    ),
  ];

  const match = resolveEntityMatch(
    question,
    history,
    suppliers.map((supplier) => ({ supplier })),
    (item) => [item.supplier],
    84
  );

  if (!match) return null;

  return (
    data.inventoryIntel.supplierWatch.find(
      (item) => normalizeText(item.supplier) === normalizeText(match.supplier)
    ) || { supplier: match.supplier }
  );
}

function findMentionedPurchaseOrder(question, data, history = []) {
  return resolveEntityMatch(
    question,
    history,
    data.purchaseOrders,
    (order) => [order.id, ...(order.items || []).map((item) => item.name)],
    90
  );
}

function findMentionedCycleCount(question, data, history = []) {
  return resolveEntityMatch(
    question,
    history,
    data.cycleCounts,
    (count) => [count.id, ...(count.items || []).map((item) => item.name)],
    90
  );
}

function detectEntityScope(question, data, history = []) {
  if (findMentionedPurchaseOrder(question, data, history)) return "purchase-orders";
  if (findMentionedCycleCount(question, data, history)) return "cycle-counts";
  if (findMentionedCustomer(question, data, history)) return "customers";
  if (findMentionedProduct(question, data, history)) return "inventory";
  if (findMentionedSupplier(question, data, history)) return "suppliers";
  if (findMentionedCashier(question, data, history)) return "orders";
  if (findMentionedCategory(question, data, history)) return "revenue";
  return null;
}

function shouldClarifyQuestion(question, data, history = []) {
  const direct = normalizeText(question);
  if (!direct) return false;

  if (isGreeting(direct) || isThanks(direct) || isCapabilityQuestion(direct)) {
    return false;
  }

  if (detectAiSignalIntent(direct)) {
    return false;
  }

  if (detectScopeFromQuery(direct) || detectEntityScope(question, data)) {
    return false;
  }

  if (isGeneralBusinessIntent(direct)) {
    return false;
  }

  if (isContextualFollowUp(direct)) {
    const combinedScope = detectScopeFromQuery(buildContextQuery(question, history).combined);
    const contextualEntityScope = detectEntityScope(question, data, history);
    return !(combinedScope || contextualEntityScope);
  }

  const tokens = tokenizeText(question);
  const compact = direct.replace(/[^a-z0-9]/g, "");
  const vowels = (compact.match(/[aeiou]/g) || []).length;
  const letters = (compact.match(/[a-z]/g) || []).length;

  if (!tokens.length) return true;
  if (tokens.length <= 2 && letters >= 6 && vowels <= 1) return true;

  return true;
}

function detectScopeFromQuery(query = "") {
  if (!query) return null;

  if (
    includesAny(query, [
      "customer",
      "customers",
      "retention",
      "walk-in",
      "walk in",
      "named account",
      "named customer",
      "repeat customer",
      "repeat customers",
      "cooling",
      "cooling off",
      "cooling account",
      "customer concentration",
      "lead customer",
      "churn",
    ])
  ) {
    return "customers";
  }

  if (includesAny(query, ["purchase order", "purchase orders", "po-", "supplier order", "receiving"])) {
    return "purchase-orders";
  }

  if (
    includesAny(query, [
      "supplier",
      "suppliers",
      "vendor",
      "vendors",
      "fill rate",
      "lead time",
      "lead times",
      "service score",
      "service quality",
      "supplier risk",
      "supplier risks",
      "commitment",
      "commitments",
      "receipt",
      "receipts",
      "inbound",
    ])
  ) {
    return "suppliers";
  }

  if (includesAny(query, ["cycle count", "cycle counts", "count variance", "variance", "stock count"])) {
    return "cycle-counts";
  }

  if (
    includesAny(query, [
      "inventory",
      "stock",
      "reorder",
      "supplier",
      "shelf",
      "dormant",
      "out of stock",
      "low stock",
      "sku",
      "product",
      "best seller",
      "best-selling",
      "sold best",
      "top seller",
    ])
  ) {
    return "inventory";
  }

  if (
    includesAny(query, [
      "order",
      "checkout",
      "payment",
      "pending",
      "declined",
      "channel",
      "daypart",
      "cashier",
      "conversion",
      "how many orders",
      "order count",
    ])
  ) {
    return "orders";
  }

  if (includesAny(query, ["staff", "team", "user", "users", "manager", "cashier", "inventory clerk", "role"])) {
    return "staff";
  }

  if (
    includesAny(query, [
      "revenue",
      "profit",
      "growth",
      "category",
      "forecast",
      "sales",
      "money",
      "business",
      "performance",
      "how much",
      "profitability",
    ])
  ) {
    return "revenue";
  }

  return null;
}

function inferAssistantScope(question, data, history = []) {
  const { direct, combined } = buildContextQuery(question, history);
  const directScope = detectScopeFromQuery(direct) || detectEntityScope(question, data);

  if (directScope) {
    return directScope;
  }

  if (isContextualFollowUp(direct)) {
    return detectScopeFromQuery(combined) || detectEntityScope(question, data, history) || "general";
  }

  if (isGeneralBusinessIntent(direct)) {
    return "general";
  }

  return null;
}

function capitalizePrompt(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  return `${trimmed[0].toUpperCase()}${trimmed.slice(1)}`;
}

function buildFollowUps(questionBack = "", suppliedFollowUps = []) {
  if (Array.isArray(suppliedFollowUps) && suppliedFollowUps.length) {
    return suppliedFollowUps
      .map((item) => capitalizePrompt(item).replace(/[.?\s]+$/, ""))
      .filter(Boolean)
      .slice(0, 4);
  }

  const cleaned = String(questionBack || "")
    .trim()
    .replace(/^do you want me to\s+/i, "")
    .replace(/^do you want to\s+/i, "")
    .replace(/^do you want\s+/i, "")
    .replace(/^for example,\s*/i, "")
    .replace(/[?]+$/g, "")
    .trim();

  if (!cleaned || /what do you want to check next/i.test(cleaned)) {
    return [];
  }

  return cleaned
    .split(/\s+or\s+|,\s*/i)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => item.replace(/^the\s+/i, ""))
    .map((item) => capitalizePrompt(item).replace(/[.?\s]+$/, ""))
    .filter(Boolean)
    .slice(0, 4);
}

const ASSISTANT_ROUTE_ACTIONS = {
  dashboardCashPulse: {
    label: "Highlight cash pulse on Dashboard",
    path: "/",
    focus: "dashboard-cash-pulse",
    note: "Cash capture and payment quality",
  },
  dashboardDemandDrivers: {
    label: "Highlight demand drivers on Dashboard",
    path: "/",
    focus: "dashboard-demand-drivers",
    note: "Category pressure and demand leaders",
  },
  dashboardTradingWindow: {
    label: "Highlight trading window on Dashboard",
    path: "/",
    focus: "dashboard-trading-window",
    note: "Daypart yield and checkout coverage",
  },
  inventoryReorderPlanner: {
    label: "Highlight reorder planner in Inventory",
    path: "/pos-dashboard",
    focus: "inventory-reorder-planner",
    note: "Priority reorder queue",
  },
  inventoryOperationsRail: {
    label: "Highlight operations rail in Inventory",
    path: "/pos-dashboard",
    focus: "inventory-operations-rail",
    note: "Purchase orders and cycle counts",
  },
  inventoryDirectory: {
    label: "Highlight stock directory in Inventory",
    path: "/pos-dashboard",
    focus: "inventory-directory",
    note: "Live SKU table and stock status",
  },
  ordersCashCapture: {
    label: "Highlight cash capture in Orders",
    path: "/orders",
    focus: "orders-cash-capture",
    note: "Resolution mix and revenue leakage",
  },
  ordersTradingWindow: {
    label: "Highlight trading window in Orders",
    path: "/orders",
    focus: "orders-trading-window",
    note: "Daypart yield and basket quality",
  },
  ordersCashiers: {
    label: "Highlight cashier board in Orders",
    path: "/orders",
    focus: "orders-cashiers",
    note: "Cashier performance and ranking",
  },
  reportsRunway: {
    label: "Highlight runway in Reports",
    path: "/reports",
    focus: "reports-runway",
    note: "Actual versus forecast",
  },
  reportsCategoryConcentration: {
    label: "Highlight category concentration in Reports",
    path: "/reports",
    focus: "reports-category-concentration",
    note: "Category dependence and concentration",
  },
  reportsProductDependence: {
    label: "Highlight product dependence in Reports",
    path: "/reports",
    focus: "reports-product-dependence",
    note: "Product-level revenue exposure",
  },
  customersMomentum: {
    label: "Highlight customer momentum",
    path: "/customers",
    focus: "customers-momentum",
    note: "Named, walk-in, and repeat demand",
  },
  customersRetention: {
    label: "Highlight retention watch in Customers",
    path: "/customers",
    focus: "customers-retention",
    note: "Cooling and growth accounts",
  },
  customersDirectory: {
    label: "Highlight customer directory",
    path: "/customers",
    focus: "customers-directory",
    note: "Named account detail and segment view",
  },
  suppliersService: {
    label: "Highlight service scoreboard in Suppliers",
    path: "/suppliers",
    focus: "suppliers-service",
    note: "Fill rate, lead time, and open commitment quality",
  },
  suppliersCommitments: {
    label: "Highlight commitments table in Suppliers",
    path: "/suppliers",
    focus: "suppliers-open-orders",
    note: "Open commitments and inbound execution",
  },
  suppliersRiskLadder: {
    label: "Highlight supplier risk ladder",
    path: "/suppliers",
    focus: "suppliers-risk-ladder",
    note: "Supplier priority and pressure ranking",
  },
  suppliersDirectory: {
    label: "Highlight supplier directory",
    path: "/suppliers",
    focus: "suppliers-directory",
    note: "Supplier-by-supplier exposure and service detail",
  },
  usersDirectory: {
    label: "Highlight staff roster in Users",
    path: "/users",
    focus: "users-directory",
    note: "Staff directory and access coverage",
  },
};

function buildNavigationActions(...targets) {
  return Array.from(new Set(targets.flat().filter(Boolean)))
    .map((target) => ASSISTANT_ROUTE_ACTIONS[target])
    .filter(Boolean)
    .slice(0, 4);
}

function buildDrilldown(title, summary, ...targets) {
  const steps = buildNavigationActions(...targets);
  if (!steps.length) return null;

  return {
    title: String(title || "").trim(),
    summary: String(summary || "").trim(),
    steps,
  };
}

function getNavigationTargets(scope, question = "") {
  const direct = normalizeText(question);

  if (/customer|retention|repeat|walk-in|walk in|named account|named customer/.test(direct)) {
    return ["customersMomentum", "customersRetention", "customersDirectory"];
  }

  if (/supplier|vendor|fill rate|lead time|commitment|inbound|receipt|receiving/.test(direct)) {
    return ["suppliersService", "suppliersCommitments", "suppliersRiskLadder"];
  }

  if (/purchase order|po-/.test(direct)) {
    return ["suppliersCommitments", "suppliersRiskLadder", "inventoryOperationsRail"];
  }

  if (
    /reorder|stock|inventory|cycle count|count\b|restock|sku/.test(direct)
  ) {
    return ["inventoryReorderPlanner", "inventoryOperationsRail", "reportsCategoryConcentration"];
  }

  if (/cash|payment|pending|declined|checkout|cashier|order/.test(direct)) {
    return ["ordersCashCapture", "ordersCashiers", "reportsRunway"];
  }

  if (/staff|user|roster|coverage|manager|cashier|clerk/.test(direct)) {
    return ["usersDirectory", "ordersCashiers", "dashboardTradingWindow"];
  }

  if (/report|forecast|growth|category|product|revenue|profit|trend/.test(direct)) {
    return ["reportsRunway", "reportsCategoryConcentration", "dashboardDemandDrivers"];
  }

  switch (scope) {
    case "inventory":
    case "cycle-counts":
      return ["inventoryReorderPlanner", "inventoryOperationsRail", "reportsCategoryConcentration"];
    case "suppliers":
      return ["suppliersService", "suppliersCommitments", "suppliersRiskLadder"];
    case "purchase-orders":
      return ["suppliersCommitments", "suppliersRiskLadder", "inventoryOperationsRail"];
    case "orders":
      return ["ordersCashCapture", "ordersTradingWindow", "ordersCashiers"];
    case "staff":
      return ["usersDirectory", "ordersCashiers", "dashboardTradingWindow"];
    case "revenue":
      return ["reportsRunway", "reportsProductDependence", "dashboardCashPulse"];
    case "general":
    default:
      return ["dashboardCashPulse", "inventoryReorderPlanner", "reportsRunway"];
  }
}

function withNavigationActions(reply, scope, question = "") {
  if (!reply) return reply;

  const existingActions = Array.isArray(reply.actions) ? reply.actions.filter(Boolean) : [];
  if (existingActions.length) {
    return reply;
  }

  return {
    ...reply,
    actions: buildNavigationActions(getNavigationTargets(scope, question)),
  };
}

function buildAssistantPayload({
  answer,
  headline,
  highlights = [],
  comparisons = [],
  actions = [],
  drilldowns = [],
  sources = [],
  statusTone = "success",
  questionBack = "",
  followUps = [],
}) {
  const externalEnabled = Boolean(runtime.externalAssistantEnabled);

  return {
    engine: {
      mode: externalEnabled ? "grounded-external-hybrid" : "grounded-assistant",
      label: "Owner AI Assistant",
      liveModel: externalEnabled,
      detail: externalEnabled
        ? `Grounded in live workspace data with OpenAI (${runtime.openAiModel}) available for hybrid answer routing.`
        : "Grounded in live workspace data and business rules.",
    },
    statusTone,
    statusLabel: getStatusDescriptor(statusTone),
    headline,
    answer,
    highlights,
    comparisons,
    actions,
    drilldowns,
    sources,
    questionBack,
    followUps: buildFollowUps(questionBack, followUps),
    disclosure: externalEnabled
      ? `Answers are grounded in live workspace data. OpenAI (${runtime.openAiModel}) is available for hybrid answer routing when the question calls for it.`
      : "Answers are grounded in live workspace data. External model mode is not configured.",
  };
}

function buildComparisonTable(title, columns = [], rows = [], caption = "") {
  const safeRows = Array.isArray(rows)
    ? rows
        .filter((row) => Array.isArray(row) && row.length)
        .map((row) => row.map((cell) => String(cell ?? "")))
    : [];

  if (!safeRows.length) return null;

  return {
    title: String(title || "").trim(),
    caption: String(caption || "").trim(),
    columns: Array.isArray(columns) ? columns.map((column) => String(column || "")) : [],
    rows: safeRows,
  };
}

function buildReorderComparison(items = [], limit = 5) {
  return buildComparisonTable(
    "Priority Reorder Queue",
    ["SKU", "Supplier", "Stock", "Cover", "Urgency"],
    items.slice(0, limit).map((item) => [
      item.name,
      item.supplier || "Unknown",
      String(Number(item.stock || 0)),
      formatDaysCover(item.estimatedDaysCover),
      item.status || "Watch",
    ]),
    "The SKUs that need replenishment first."
  );
}

function buildSupplierPressureComparison(items = [], limit = 5) {
  return buildComparisonTable(
    "Supplier Pressure",
    ["Supplier", "At-Risk SKUs", "Urgency Score"],
    items.slice(0, limit).map((item) => [
      item.supplier || "Unknown",
      String(Number(item.atRiskProducts || item.exposedSkuCount || item.lowStockLines || 0)),
      Number(item.urgencyScore || item.topExposure?.urgencyScore || item.exposedRevenue || 0).toFixed(1),
    ]),
    "Suppliers carrying the highest current exposure."
  );
}

function buildSupplierServiceBoardComparison(suppliers = [], limit = 5) {
  return buildComparisonTable(
    "Supplier Service Board",
    ["Supplier", "Status", "Fill Rate", "Lead Time", "Open POs"],
    suppliers.slice(0, limit).map((supplier) => [
      supplier.supplier || "Unknown",
      supplier.status || "Stable",
      Number(supplier.unitsOrdered || 0) > 0 ? formatPercent(supplier.fillRate) : "No ordered units",
      Number(supplier.avgLeadTimeDays || 0) > 0
        ? `${Number(supplier.avgLeadTimeDays).toFixed(1)} days`
        : "No received history",
      String(Number(supplier.openPoCount || 0)),
    ]),
    "Service quality and inbound execution by supplier from live purchase-order history."
  );
}

function buildCashExposureComparison(data) {
  return buildComparisonTable(
    "Cash Exposure",
    ["Status", "Orders", "Revenue"],
    [
      ["Paid", String(Number(data.overview.paidOrders || 0)), formatMoney(data.overview.paidRevenue)],
      [
        "Pending",
        String(Number(data.overview.pendingOrders || 0)),
        formatMoney(data.overview.pendingRevenue),
      ],
      [
        "Declined",
        String(Number(data.overview.declinedOrders || 0)),
        formatMoney(data.overview.declinedRevenue),
      ],
    ],
    "Where revenue is being captured cleanly and where it is leaking."
  );
}

function buildPaymentComparison(items = [], limit = 5) {
  return buildComparisonTable(
    "Payment Mix",
    ["Method", "Orders", "Revenue"],
    items.slice(0, limit).map((item) => [
      item.label,
      String(Number(item.value || 0)),
      formatMoney(item.revenue),
    ]),
    "Payment methods currently driving checkout."
  );
}

function buildChannelComparison(items = [], limit = 5) {
  return buildComparisonTable(
    "Channel Mix",
    ["Channel", "Orders", "Revenue"],
    items.slice(0, limit).map((item) => [
      item.label,
      String(Number(item.value || 0)),
      formatMoney(item.revenue),
    ]),
    "Sales channels carrying current order flow."
  );
}

function buildCashierComparison(items = [], limit = 5) {
  return buildComparisonTable(
    "Cashier Comparison",
    ["Cashier", "Orders", "Revenue", "Avg Basket"],
    items.slice(0, limit).map((item) => [
      item.cashier,
      String(Number(item.orders || 0)),
      formatMoney(item.revenue),
      formatMoney(item.averageOrderValue),
    ]),
    "Checkout performance by cashier."
  );
}

function buildCustomerComparison(title, items = [], limit = 5, caption = "") {
  return buildComparisonTable(
    title,
    ["Customer", "Segment", "Orders", "Revenue", "Last Seen"],
    items.slice(0, limit).map((item) => [
      item.customer,
      item.segment || "Unknown",
      String(Number(item.orders || 0)),
      formatMoney(item.paidRevenue || 0),
      `${Number(item.daysSinceLastSeen || 0)} days`,
    ]),
    caption
  );
}

function buildProductComparison(items = [], limit = 5) {
  return buildComparisonTable(
    "Product Leaders",
    ["Product", "Category", "Units", "Revenue"],
    items.slice(0, limit).map((item) => [
      item.name,
      item.category || "General",
      String(Number(item.unitsSold || 0)),
      formatMoney(item.revenue || item.value),
    ]),
    "Products currently carrying the most business value."
  );
}

function buildCategoryComparison(items = [], limit = 5) {
  return buildComparisonTable(
    "Category Leaders",
    ["Category", "Revenue"],
    items.slice(0, limit).map((item) => [item.name, formatMoney(item.value || item.revenue)]),
    "Categories currently carrying the most revenue."
  );
}

function buildPurchaseOrderComparison(orders = [], limit = 5) {
  return buildComparisonTable(
    "Open Purchase Orders",
    ["PO", "Supplier", "Status", "Value"],
    orders
      .filter((order) => ["Draft", "Sent"].includes(String(order.status)))
      .slice(0, limit)
      .map((order) => [
        order.id,
        order.supplier || "Unknown",
        String(order.status || "Draft"),
        formatMoney(order.totalEstimatedCost),
      ]),
    "Open supplier commitments still affecting inventory coverage."
  );
}

function buildShiftCoverageComparison(dayparts = [], cashiers = 0, managers = 0, clerks = 0) {
  return buildComparisonTable(
    "Shift Pressure",
    ["Window", "Orders", "Revenue", "Coverage Note"],
    dayparts.map((item) => {
      let coverageNote = "Low traffic";

      if (Number(item.orders || 0) > 0) {
        if (cashiers === 0) {
          coverageNote = "No cashier coverage";
        } else if (cashiers === 1 && Number(item.orders || 0) >= 1) {
          coverageNote = "Single cashier under load";
        } else if (managers === 0) {
          coverageNote = "No manager escalation";
        } else if (clerks === 0 && Number(item.orders || 0) >= 1) {
          coverageNote = "Inventory handoff exposed";
        } else {
          coverageNote = "Covered";
        }
      }

      return [
        item.label,
        String(Number(item.orders || 0)),
        formatMoney(item.revenue || 0),
        coverageNote,
      ];
    }),
    "Trading windows sized against current roster depth."
  );
}

function getDateDiffDays(startValue, endValue) {
  const start = new Date(startValue);
  const end = new Date(endValue);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return null;
  }

  const diff = end.getTime() - start.getTime();
  if (diff < 0) return null;

  return diff / (1000 * 60 * 60 * 24);
}

function getSupplierServiceMetrics(supplierOrders = []) {
  const receivedOrders = supplierOrders.filter(
    (order) => order.receivedAt && Number(order.unitsOrdered || 0) > 0
  );
  const leadTimes = receivedOrders
    .map((order) => getDateDiffDays(order.createdAt, order.receivedAt))
    .filter((value) => Number.isFinite(value));
  const averageLeadTimeDays = leadTimes.length
    ? leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length
    : null;
  const totalUnitsOrdered = supplierOrders.reduce(
    (sum, order) => sum + Number(order.unitsOrdered || 0),
    0
  );
  const totalUnitsReceived = supplierOrders.reduce(
    (sum, order) => sum + Number(order.unitsReceived || 0),
    0
  );
  const fillRate = totalUnitsOrdered ? (totalUnitsReceived / totalUnitsOrdered) * 100 : null;

  return {
    receivedOrdersCount: receivedOrders.length,
    averageLeadTimeDays,
    fillRate,
    totalUnitsOrdered,
    totalUnitsReceived,
  };
}

function buildSupplierServiceComparison(supplierName, supplierOrders = []) {
  const metrics = getSupplierServiceMetrics(supplierOrders);

  return buildComparisonTable(
    `${supplierName} service signal`,
    ["Metric", "Value"],
    [
      ["Recorded POs", String(supplierOrders.length)],
      ["Received POs", String(metrics.receivedOrdersCount)],
      [
        "Avg Lead Time",
        metrics.averageLeadTimeDays === null
          ? "No received history"
          : `${metrics.averageLeadTimeDays.toFixed(1)} days`,
      ],
      [
        "Fill Rate",
        metrics.fillRate === null ? "No ordered units" : formatPercent(metrics.fillRate),
      ],
    ],
    "Lead-time and fill-rate signals based on recorded purchase-order history."
  );
}

function rankSupplierPressureItems(items = []) {
  return [...items].sort((a, b) => {
    const aStock = Number(a.stock || 0);
    const bStock = Number(b.stock || 0);
    const aSeverity = aStock <= 5 ? 0 : aStock <= 10 ? 1 : 2;
    const bSeverity = bStock <= 5 ? 0 : bStock <= 10 ? 1 : 2;

    if (aSeverity !== bSeverity) {
      return aSeverity - bSeverity;
    }

    const aCover = Number.isFinite(Number(a.estimatedDaysCover))
      ? Number(a.estimatedDaysCover)
      : 9999;
    const bCover = Number.isFinite(Number(b.estimatedDaysCover))
      ? Number(b.estimatedDaysCover)
      : 9999;

    if (aCover !== bCover) {
      return aCover - bCover;
    }

    return Number(b.urgencyScore || 0) - Number(a.urgencyScore || 0);
  });
}

function getSupplierRiskDetails(supplierName, data) {
  const supplierKey = normalizeText(supplierName);
  const pressuredSkus = rankSupplierPressureItems(
    (data.inventoryIntel?.reorderNow || []).filter(
      (item) => normalizeText(item.supplier) === supplierKey
    )
  );
  const supplierOrders = (data.purchaseOrders || []).filter(
    (order) => normalizeText(order.supplier) === supplierKey
  );
  const openOrders = supplierOrders.filter((order) =>
    ["Draft", "Sent"].includes(String(order.status))
  );
  const openOrderValue = openOrders.reduce(
    (sum, order) => sum + Number(order.totalEstimatedCost || 0),
    0
  );
  const supplierSkuCount = (data.products || []).filter(
    (product) => normalizeText(product.supplier) === supplierKey
  ).length;
  const supplierShare = data.products.length
    ? (supplierSkuCount / data.products.length) * 100
    : 0;
  const leadSku = pressuredSkus[0] || null;
  const serviceMetrics = getSupplierServiceMetrics(supplierOrders);
  const leadTimeNote =
    serviceMetrics.averageLeadTimeDays === null
      ? "Lead time is not measurable yet because no received purchase-order history is recorded."
      : `Average recorded lead time is ${serviceMetrics.averageLeadTimeDays.toFixed(1)} days.`;
  const fillRateNote =
    serviceMetrics.fillRate === null
      ? "Fill rate is not measurable yet from the current order history."
      : `Recorded fill progress is ${formatPercent(serviceMetrics.fillRate)} across tracked purchase-order units.`;

  let statusTone = "success";
  let answer = `${supplierName} is currently stable. There are no pressured SKUs concentrated with this supplier.`;

  if (pressuredSkus.length && !openOrders.length) {
    statusTone = Number(leadSku?.stock || 0) <= 5 ? "danger" : "warning";
    answer = `${supplierName} is a live supplier risk. ${pressuredSkus.length} pressured SKUs still depend on this supplier and there is no open purchase-order cover in the system. ${
      leadSku
        ? `${leadSku.name} is the most exposed line with ${leadSku.stock} units left and ${formatDaysCover(
            leadSku.estimatedDaysCover
          )}.`
        : ""
    } The next move is to place or expedite stock with ${supplierName} before availability breaks. ${leadTimeNote} ${fillRateNote}`;
  } else if (pressuredSkus.length && openOrders.length) {
    statusTone = "warning";
    answer = `${supplierName} is still carrying operational pressure, but the exposure is being worked. ${pressuredSkus.length} pressured SKUs depend on this supplier and ${openOrders.length} open purchase orders worth ${formatMoney(
      openOrderValue
    )} are already in motion. ${
      leadSku
        ? `${leadSku.name} is the SKU to protect first until those orders are received.`
        : "Receiving speed matters more than placing extra orders right now."
    } ${leadTimeNote} ${fillRateNote}`;
  } else if (openOrders.length) {
    statusTone = "warning";
    answer = `${supplierName} is not the biggest stockout risk right now, but ${openOrders.length} open purchase orders worth ${formatMoney(
      openOrderValue
    )} are still outstanding. This is a supplier follow-through and receipt-timing issue, not an emergency reorder problem. ${leadTimeNote} ${fillRateNote}`;
  } else {
    answer = `${answer} ${leadTimeNote} ${fillRateNote}`;
  }

  return {
    supplierName,
    pressuredSkus,
    supplierOrders,
    openOrders,
    openOrderValue,
    leadSku,
    supplierSkuCount,
    supplierShare,
    serviceMetrics,
    statusTone,
    answer,
  };
}

function buildStaffCoverageComparison(data, inactiveCount = 0) {
  return buildComparisonTable(
    "Coverage By Role",
    ["Role", "Active", "Coverage"],
    [
      [
        "Managers",
        String(data.managers.length),
        data.managers.length === 0 ? "Thin" : data.managers.length === 1 ? "Lean" : "Covered",
      ],
      [
        "Cashiers",
        String(data.cashiers.length),
        data.cashiers.length === 0
          ? "Uncovered"
          : data.cashiers.length === 1
          ? "Fragile"
          : "Covered",
      ],
      [
        "Inventory Clerks",
        String(data.clerks.length),
        data.clerks.length === 0
          ? "Uncovered"
          : data.clerks.length === 1
          ? "Single Owner"
          : "Covered",
      ],
      ["Inactive Accounts", String(inactiveCount), inactiveCount > 0 ? "Cleanup" : "Clean"],
    ],
    "Role coverage and access hygiene across the active roster."
  );
}

function answerTimeScopedQuestion(question, data, history = []) {
  const scope = getTimeScope(question, data);
  if (!scope) return null;

  const query = normalizeText(question);
  const scopedSales = getSalesInTimeScope(data, scope);
  const snapshot = buildSalesSnapshot(scopedSales, data.products);
  const matchedProduct = findMentionedProduct(question, data, history);
  const matchedCategory = findMentionedCategory(question, data, history);
  const matchedCashier = findMentionedCashier(question, data, history);

  if (!scopedSales.length) {
    return buildAssistantPayload({
      statusTone: "warning",
      headline: `No recorded activity for ${scope.label}`,
      answer: `There are no recorded sales for ${scope.label} (${scope.rangeLabel}) in the current workspace data.`,
      questionBack: "Do you want a wider view like this week, this month, or the overall business picture?",
      sources: ["sales"],
    });
  }

  if (matchedProduct) {
    const productSnapshot = buildProductTimeSnapshot(matchedProduct.name, scopedSales, data.products);
    return buildAssistantPayload({
      statusTone: productSnapshot.stock <= 10 ? "warning" : "success",
      headline: `${productSnapshot.name} in ${scope.label}`,
      answer: `${productSnapshot.name} generated ${formatMoney(productSnapshot.revenue)} from ${
        productSnapshot.unitsSold
      } units sold in ${scope.label} (${scope.rangeLabel}). It currently has ${
        productSnapshot.stock
      } units on hand and sits in ${productSnapshot.category}.`,
      highlights: [
        { label: "Revenue", value: formatMoney(productSnapshot.revenue) },
        { label: "Units Sold", value: String(productSnapshot.unitsSold) },
        { label: "On Hand", value: String(productSnapshot.stock) },
        { label: "Period", value: scope.label },
      ],
      questionBack: `Do you want me to compare ${productSnapshot.name} against the rest of the store for ${scope.label}?`,
      sources: ["sales", "inventory"],
    });
  }

  if (matchedCategory) {
    const categorySnapshot = buildCategoryTimeSnapshot(matchedCategory.name, scopedSales, data.products);
    return buildAssistantPayload({
      headline: `${matchedCategory.name} in ${scope.label}`,
      answer: `${matchedCategory.name} generated ${formatMoney(categorySnapshot.revenue)} from ${
        categorySnapshot.unitsSold
      } units sold in ${scope.label} (${scope.rangeLabel}).`,
      highlights: [
        { label: "Revenue", value: formatMoney(categorySnapshot.revenue) },
        { label: "Units Sold", value: String(categorySnapshot.unitsSold) },
        { label: "Period", value: scope.label },
      ],
      questionBack: `Do you want the strongest products inside ${matchedCategory.name} for ${scope.label}?`,
      sources: ["sales", "reports"],
    });
  }

  if (
    matchedCashier &&
    includesAny(query, ["compare"]) &&
    includesAny(query, ["top cashier", "strongest cashier", "best cashier"])
  ) {
    const cashierRevenue = scopedSales
      .filter((sale) => normalizeText(sale.cashier) === normalizeText(matchedCashier.cashier))
      .reduce(
        (accumulator, sale) => {
          accumulator.revenue += Number(sale.total || 0);
          accumulator.orders += 1;
          return accumulator;
        },
        { revenue: 0, orders: 0 }
      );

    const topCashier = snapshot.topCashier || {
      cashier: matchedCashier.cashier,
      revenue: cashierRevenue.revenue,
      orders: cashierRevenue.orders,
      averageOrderValue: cashierRevenue.orders ? cashierRevenue.revenue / cashierRevenue.orders : 0,
    };
    const currentAverage = cashierRevenue.orders ? cashierRevenue.revenue / cashierRevenue.orders : 0;
    const gap = Number(topCashier.revenue || 0) - Number(cashierRevenue.revenue || 0);
    const isLeader = normalizeText(topCashier.cashier) === normalizeText(matchedCashier.cashier);

    return buildAssistantPayload({
      statusTone: isLeader ? "success" : "warning",
      headline: `${matchedCashier.cashier} vs top cashier in ${scope.label}`,
      answer: isLeader
        ? `${matchedCashier.cashier} is already the top cashier in ${scope.label}, generating ${formatMoney(
            cashierRevenue.revenue
          )} across ${cashierRevenue.orders} orders.`
        : `${matchedCashier.cashier} is behind ${topCashier.cashier} by ${formatMoney(
            gap
          )} in ${scope.label}. ${matchedCashier.cashier} generated ${formatMoney(
            cashierRevenue.revenue
          )} across ${cashierRevenue.orders} orders, while ${topCashier.cashier} generated ${formatMoney(
            topCashier.revenue
          )} across ${topCashier.orders} orders.`,
      highlights: [
        { label: matchedCashier.cashier, value: formatMoney(cashierRevenue.revenue) },
        { label: "Top Cashier", value: topCashier.cashier },
        { label: "Revenue Gap", value: formatMoney(Math.max(gap, 0)) },
        { label: "Period", value: scope.label },
      ],
      comparisons: [
        buildComparisonTable(
          "Cashier Comparison",
          ["Cashier", "Orders", "Revenue", "Avg Basket"],
          [
            [
              matchedCashier.cashier,
              String(cashierRevenue.orders),
              formatMoney(cashierRevenue.revenue),
              formatMoney(currentAverage),
            ],
            [
              topCashier.cashier,
              String(Number(topCashier.orders || 0)),
              formatMoney(topCashier.revenue),
              formatMoney(topCashier.averageOrderValue),
            ],
          ],
          `Direct cashier comparison for ${scope.label}.`
        ),
      ].filter(Boolean),
      questionBack: `Do you want checkout friction or payment mix for ${scope.label} too?`,
      sources: ["orders", "staff"],
    });
  }

  if (
    matchedCashier &&
    !matchedProduct &&
    !matchedCategory &&
    (
      includesAny(query, [
        "cashier",
        "staff",
        "team",
        "who sold",
        "who did best",
        "how did",
        "how is",
        "doing",
        "perform",
        "performance",
      ]) ||
      tokenizeForMatch(question).includes(tokenizeForMatch(matchedCashier.cashier)[0])
    )
  ) {
    const cashierRevenue = scopedSales
      .filter((sale) => normalizeText(sale.cashier) === normalizeText(matchedCashier.cashier))
      .reduce(
        (accumulator, sale) => {
          accumulator.revenue += Number(sale.total || 0);
          accumulator.orders += 1;
          return accumulator;
        },
        { revenue: 0, orders: 0 }
      );

    return buildAssistantPayload({
      headline: `${matchedCashier.cashier} in ${scope.label}`,
      answer: `${matchedCashier.cashier} processed ${cashierRevenue.orders} orders for ${formatMoney(
        cashierRevenue.revenue
      )} in ${scope.label} (${scope.rangeLabel}).`,
      highlights: [
        { label: "Orders", value: String(cashierRevenue.orders) },
        { label: "Revenue", value: formatMoney(cashierRevenue.revenue) },
        {
          label: "Avg Basket",
          value: formatMoney(cashierRevenue.orders ? cashierRevenue.revenue / cashierRevenue.orders : 0),
        },
        { label: "Period", value: scope.label },
      ],
      questionBack: `Do you want me to compare ${matchedCashier.cashier} against the top cashier for ${scope.label}?`,
      sources: ["orders", "staff"],
    });
  }

  if (
    includesAny(query, [
      "best seller",
      "best-selling",
      "sold best",
      "top seller",
      "top product",
      "strongest product",
      "best product",
    ])
  ) {
    return buildAssistantPayload({
      headline: `Best seller in ${scope.label}`,
      answer: snapshot.topProduct
        ? `${snapshot.topProduct.name} was the strongest product in ${scope.label}, generating ${formatMoney(
            snapshot.topProduct.revenue
          )} from ${snapshot.topProduct.unitsSold} units sold.`
        : `No clear best seller is visible for ${scope.label}.`,
      highlights: snapshot.topProduct
        ? [
            { label: "Product", value: snapshot.topProduct.name },
            { label: "Revenue", value: formatMoney(snapshot.topProduct.revenue) },
            { label: "Units Sold", value: String(snapshot.topProduct.unitsSold) },
            { label: "Category", value: snapshot.topProduct.category || "General" },
          ]
        : [{ label: "Period", value: scope.label }],
      questionBack: `Do you want the top category or top cashier for ${scope.label} too?`,
      sources: ["sales", "inventory"],
    });
  }

  if (includesAny(query, ["top category", "best category", "strongest category", "which category"])) {
    return buildAssistantPayload({
      headline: `Top category in ${scope.label}`,
      answer: snapshot.topCategory
        ? `${snapshot.topCategory.name} was the strongest category in ${scope.label}, generating ${formatMoney(
            snapshot.topCategory.revenue
          )}.`
        : `No category leader is visible for ${scope.label}.`,
      highlights: snapshot.topCategory
        ? [
            { label: "Category", value: snapshot.topCategory.name },
            { label: "Revenue", value: formatMoney(snapshot.topCategory.revenue) },
            { label: "Period", value: scope.label },
          ]
        : [{ label: "Period", value: scope.label }],
      questionBack: `Do you want the strongest products inside ${snapshot.topCategory?.name || "that period"}?`,
      sources: ["sales", "reports"],
    });
  }

  if (includesAny(query, ["top cashier", "best cashier", "who sold most", "who did best"])) {
    return buildAssistantPayload({
      headline: `Top cashier in ${scope.label}`,
      answer: snapshot.topCashier
        ? `${snapshot.topCashier.cashier} led ${scope.label} with ${formatMoney(
            snapshot.topCashier.revenue
          )} across ${snapshot.topCashier.orders} orders.`
        : `No cashier leader is visible for ${scope.label}.`,
      highlights: snapshot.topCashier
        ? [
            { label: "Cashier", value: snapshot.topCashier.cashier },
            { label: "Revenue", value: formatMoney(snapshot.topCashier.revenue) },
            { label: "Orders", value: String(snapshot.topCashier.orders) },
            { label: "Avg Basket", value: formatMoney(snapshot.topCashier.averageOrderValue) },
          ]
        : [{ label: "Period", value: scope.label }],
      questionBack: `Do you want me to connect that cashier performance to payment reliability or order volume?`,
      sources: ["orders", "staff"],
    });
  }

  if (includesAny(query, ["profit"])) {
    const profitCoverageRate = Number(snapshot.profitCoverageRate || 0);
    const recognizedProfit = Number(snapshot.recognizedProfit || 0);
    const uncostedRevenue = Number(snapshot.uncostedRevenue || 0);

    return buildAssistantPayload({
      statusTone: profitCoverageRate < 95 ? "warning" : recognizedProfit < 0 ? "danger" : "success",
      headline: `Profit picture for ${scope.label}`,
      answer: `Recognized gross profit for ${scope.label} (${scope.rangeLabel}) is ${formatMoney(
        recognizedProfit
      )} on ${formatMoney(snapshot.totalRevenue)} in revenue. ${
        profitCoverageRate < 95
          ? `${formatMoney(uncostedRevenue)} of revenue in that period still has no stored unit cost, so profit is only grounded on ${formatPercent(
              profitCoverageRate
            )} of revenue.`
          : "Unit-cost coverage is complete for the sales recorded in that period."
      }`,
      highlights: [
        { label: "Revenue", value: formatMoney(snapshot.totalRevenue) },
        { label: "Gross Profit", value: formatMoney(recognizedProfit) },
        { label: "Cost Coverage", value: formatPercent(profitCoverageRate) },
        { label: "Uncosted Revenue", value: formatMoney(uncostedRevenue) },
      ],
      questionBack: `Do you want me to break that period down by top products, top category, or payment quality?`,
      sources: ["sales", "reports", "inventory"],
    });
  }

  if (includesAny(query, ["order", "orders"]) && !includesAny(query, ["average order", "avg order", "basket"])) {
    return buildAssistantPayload({
      headline: `Order summary for ${scope.label}`,
      answer: `There were ${snapshot.orders} recorded orders in ${scope.label} (${scope.rangeLabel}), with ${
        snapshot.paidOrders
      } paid, ${snapshot.pendingOrders} pending, and ${snapshot.declinedOrders} declined.`,
      highlights: [
        { label: "Orders", value: String(snapshot.orders) },
        { label: "Paid", value: String(snapshot.paidOrders) },
        { label: "Pending", value: String(snapshot.pendingOrders) },
        { label: "Declined", value: String(snapshot.declinedOrders) },
      ],
      questionBack: `Do you want revenue, payment reliability, or the strongest cashier for ${scope.label}?`,
      sources: ["orders", "sales"],
    });
  }

  return buildAssistantPayload({
    statusTone: snapshot.pendingOrders > 0 || snapshot.declinedOrders > 0 ? "warning" : "success",
    headline: `Business summary for ${scope.label}`,
    answer: `${scope.label[0].toUpperCase()}${scope.label.slice(1)} (${scope.rangeLabel}) generated ${formatMoney(
      snapshot.totalRevenue
    )} across ${snapshot.orders} orders, with an average basket of ${formatMoney(
      snapshot.averageOrderValue
    )} and ${formatPercent(snapshot.paidRate)} paid conversion. ${
      snapshot.topProduct
        ? `${snapshot.topProduct.name} was the strongest product. `
        : ""
    }${snapshot.topCategory ? `${snapshot.topCategory.name} led category revenue.` : ""}`,
    highlights: [
      { label: "Revenue", value: formatMoney(snapshot.totalRevenue) },
      { label: "Orders", value: String(snapshot.orders) },
      { label: "Avg Basket", value: formatMoney(snapshot.averageOrderValue) },
      { label: "Paid Rate", value: formatPercent(snapshot.paidRate) },
    ],
    questionBack: `Do you want me to break ${scope.label} down by products, categories, cashiers, or payments?`,
    sources: ["sales", "reports", "orders"],
  });
}

function answerRevenueQuestion(question, data, history = []) {
  const matchedCategory = findMentionedCategory(question, data, history);
  const matchedProduct = findMentionedProduct(question, data, history);
  const growthRate = Number(data.reports.summary.growthRate || 0);
  const profitCoverageRate = Number(data.reports.summary.profitCoverageRate || 0);
  const uncostedRevenue = Number(data.reports.summary.uncostedRevenue || 0);

  if (matchedProduct) {
    return buildAssistantPayload({
      statusTone: matchedProduct.stock <= 10 ? "warning" : "success",
      headline: `${matchedProduct.name} performance`,
      answer: `${matchedProduct.name} has ${matchedProduct.stock} units on hand and has generated ${formatMoney(
        matchedProduct.revenue
      )} from ${matchedProduct.unitsSold} units sold. ${
        matchedProduct.lastSoldAt
          ? `It was last sold on ${formatDate(matchedProduct.lastSoldAt)}.`
          : "It has not recorded a sale yet."
      }`,
      highlights: [
        { label: "Revenue", value: formatMoney(matchedProduct.revenue) },
        { label: "Units Sold", value: String(matchedProduct.unitsSold) },
        { label: "On Hand", value: String(matchedProduct.stock) },
        { label: "Category", value: matchedProduct.category },
      ],
      questionBack: `Do you want me to check whether ${matchedProduct.name} should be reordered now or whether it is strong enough to use in a promotion?`,
      comparisons: [
        buildProductComparison([
          matchedProduct,
          ...data.productInsights.filter((item) => normalizeText(item.name) !== normalizeText(matchedProduct.name)),
        ]),
      ].filter(Boolean),
      sources: ["sales", "inventory"],
    });
  }

  if (matchedCategory) {
    return buildAssistantPayload({
      headline: `${matchedCategory.name} category contribution`,
      answer: `${matchedCategory.name} is currently contributing ${formatMoney(
        matchedCategory.value
      )} in revenue. ${
        data.topCategory?.name === matchedCategory.name
          ? "It is the strongest category in the business right now."
          : `${data.topCategory?.name || "Another category"} is currently ahead of it.`
      }`,
      highlights: [
        { label: "Category Revenue", value: formatMoney(matchedCategory.value) },
        { label: "Top Category", value: data.reports.summary.topCategory || "No leader yet" },
        { label: "Growth Rate", value: formatPercent(growthRate) },
      ],
      questionBack: `Do you want me to break down which products inside ${matchedCategory.name} are carrying that category?`,
      comparisons: [
        buildCategoryComparison(data.reports.categoryBreakdown),
        buildProductComparison(
          data.productInsights.filter(
            (item) => normalizeText(item.category) === normalizeText(matchedCategory.name)
          )
        ),
      ].filter(Boolean),
      sources: ["sales", "reports"],
    });
  }

  return buildAssistantPayload({
    statusTone: growthRate < 0 ? "danger" : growthRate < 8 || profitCoverageRate < 95 ? "warning" : "success",
    headline: "Revenue and growth picture",
    answer: `The business has captured ${formatMoney(
      data.overview.totalRevenue
    )} in revenue. Recognized gross profit is ${formatMoney(
      data.reports.summary.profit
    )}${
      profitCoverageRate < 95
        ? `, but that profit is only grounded on ${formatPercent(profitCoverageRate)} of revenue because ${formatMoney(
            uncostedRevenue
          )} still lacks stored unit cost`
        : ""
    }. Growth is ${formatPercent(growthRate)} and the leading category is ${
      data.reports.summary.topCategory || "not yet established"
    }. ${
      data.topProduct
        ? `${data.topProduct.name} is currently the strongest product signal.`
        : "Top product leadership will sharpen as more sales are recorded."
    }`,
    highlights: [
      { label: "Revenue", value: formatMoney(data.overview.totalRevenue) },
      { label: "Gross Profit", value: formatMoney(data.reports.summary.profit) },
      { label: "Growth", value: formatPercent(growthRate) },
      { label: "Profit Coverage", value: formatPercent(profitCoverageRate) },
      { label: "Top Category", value: data.reports.summary.topCategory || "No leader yet" },
    ],
    questionBack:
      "Do you want me to go deeper into growth, cash risk, or the products and categories driving the business?",
    comparisons: [
      buildCategoryComparison(data.reports.categoryBreakdown),
      buildProductComparison(data.productInsights),
      buildCashExposureComparison(data),
    ].filter(Boolean),
    sources: ["sales", "reports"],
  });
}

function formatDaysCover(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "cover not yet modeled";
  if (numeric < 1) return "less than 1 day of cover";
  return `${numeric.toFixed(1)} days of cover`;
}

function answerDecisionQuestion(question, data, history = []) {
  const query = normalizeText(question);
  const topPayment = data.topPaymentMethod || null;
  const topChannel = data.topChannel || null;
  const topReorders = data.inventoryIntel.reorderNow.slice(0, 3);
  const topProductInsight = data.productInsights[0] || data.topProduct || null;
  const machineForecast = data.machineForecast || null;
  const mlReorderCandidates = Array.isArray(machineForecast?.restockRecommendations)
    ? machineForecast.restockRecommendations.slice(0, 4)
    : [];
  const mlProtectCandidates = mlReorderCandidates.filter((item) =>
    ["protect-now", "invest-next"].includes(String(item.cashPriorityTier || ""))
  );
  const leadProtectCandidate = mlProtectCandidates[0] || mlReorderCandidates[0] || null;

  if (
    includesAny(query, [
      "what should i reorder",
      "what do i reorder",
      "reorder first",
      "restock first",
      "what should i restock",
      "what should i buy",
      "what do i buy",
      "what needs reordering",
    ])
  ) {
    if (!topReorders.length) {
      return buildAssistantPayload({
        headline: "Reorder queue is light",
        answer:
          "No product is showing dominant reorder pressure right now. Use this window to clean dormant stock and confirm supplier lead times instead of placing urgent replenishment.",
        highlights: [
          { label: "Queue Size", value: "0" },
          { label: "Low Stock", value: String(data.inventorySignals.lowStockCount) },
          { label: "Dormant Lines", value: String(data.inventoryIntel.summary.dormantStockCount || 0) },
        ],
        questionBack:
          "Do you want me to identify dormant stock to clear next or the suppliers carrying the most future risk?",
        comparisons: [buildSupplierPressureComparison(data.inventoryIntel.supplierWatch)].filter(Boolean),
        sources: ["inventory", "sales", "purchase orders"],
      });
    }

    return buildAssistantPayload({
      statusTone: "warning",
      headline: "Reorder these first",
      answer: `${
        leadProtectCandidate
          ? `${leadProtectCandidate.name} is the top protection line with ${Number(
              leadProtectCandidate.recommendedOrderQty || 0
            )} units suggested, ${formatPercent(
              Number(leadProtectCandidate.stockoutProbability || 0) * 100
            )} stockout probability, and a ${String(
              leadProtectCandidate.stockPolicyClass || "standard"
            )} policy. `
          : ""
      }${topReorders
        .map(
          (item, index) =>
            `${index + 1}. ${item.name} (${item.supplier}) has ${item.stock} units left and ${formatDaysCover(
              item.estimatedDaysCover
            )}.`
        )
        .join(" ")} ${
        data.supplierLead
          ? `${data.supplierLead.supplier} is the supplier carrying the highest combined pressure.`
          : ""
      }`,
      highlights: [
        { label: "First SKU", value: leadProtectCandidate?.name || topReorders[0].name },
        { label: "Lead Supplier", value: data.supplierLead?.supplier || topReorders[0].supplier },
        {
          label: "Queue Size",
          value: String(data.inventoryIntel.summary.reorderNowCount || topReorders.length),
        },
        {
          label: "At-Risk Value",
          value: formatMoney(data.inventoryIntel.summary.atRiskInventoryValue),
        },
        ...(machineForecast?.portfolioSummary
          ? [
              {
                label: "Protect Spend",
                value: formatMoney(machineForecast.portfolioSummary.highPriorityOrderSpend || 0),
              },
            ]
          : []),
      ],
      questionBack:
        "Do you want me to break the reorder queue down by supplier, by protection priority, or by which SKU is safest to defer?",
      comparisons: [
        buildReorderComparison(data.inventoryIntel.reorderNow),
        buildSupplierPressureComparison(data.inventoryIntel.supplierWatch),
      ].filter(Boolean),
      sources: ["inventory", "sales", "purchase orders"],
    });
  }

  if (
    includesAny(query, [
      "cash risk",
      "cash leaking",
      "where is cash leaking",
      "money leaking",
      "revenue at risk",
      "money at risk",
      "where is money stuck",
      "what is my biggest cash risk",
      "cash stuck",
    ])
  ) {
    const atRiskRevenue = Number(data.overview.pendingRevenue || 0) + Number(data.overview.declinedRevenue || 0);

    return buildAssistantPayload({
      statusTone: atRiskRevenue > 0 ? "warning" : "success",
      headline: "Cash risk and leakage",
      answer: `There is ${formatMoney(atRiskRevenue)} sitting outside clean captured revenue: ${formatMoney(
        data.overview.pendingRevenue
      )} in pending orders and ${formatMoney(data.overview.declinedRevenue)} in declined orders. ${
        topPayment
          ? `${topPayment.label} is the most-used payment method right now. `
          : ""
      }${
        topChannel
          ? `${topChannel.label} is the lead channel, so that is where checkout friction should be reviewed first.`
          : "Review the checkout path where pending and declined orders are appearing most often."
      }`,
      highlights: [
        { label: "Pending Revenue", value: formatMoney(data.overview.pendingRevenue) },
        { label: "Declined Revenue", value: formatMoney(data.overview.declinedRevenue) },
        { label: "Pending Orders", value: String(data.overview.pendingOrders) },
        { label: "Declined Orders", value: String(data.overview.declinedOrders) },
      ],
      questionBack:
        "Do you want me to focus next on payment reliability, channel mix, or the staff member leading checkout?",
      comparisons: [
        buildCashExposureComparison(data),
        buildPaymentComparison(data.paymentMethodBreakdown),
        buildChannelComparison(data.channelBreakdown),
      ].filter(Boolean),
      drilldowns: [
        buildDrilldown(
          "Audit cash leakage",
          "Start with the order-resolution mix, then inspect cashier performance, then confirm how much of the revenue path is degrading future runway.",
          ["ordersCashCapture", "ordersCashiers", "reportsRunway"]
        ),
      ].filter(Boolean),
      sources: ["orders", "sales", "payments"],
    });
  }

  if (
    includesAny(query, [
      "what should i protect",
      "what should i defend",
      "what should i push",
      "what should i promote",
      "what should we protect",
      "what should we push",
      "what should i feature",
    ])
  ) {
    const topRiskName = leadProtectCandidate?.name || data.topRisk?.name || "the reorder queue";
    const topGrowthName = topProductInsight?.name || data.topCategory?.name || "your top-selling mix";

    return buildAssistantPayload({
      statusTone:
        data.topRisk && data.topProduct && normalizeText(data.topRisk.name) === normalizeText(data.topProduct.name)
          ? "warning"
          : "success",
      headline: "Protect this, push that",
      answer: `${topGrowthName} is the clearest thing to defend on the revenue side right now. ${
        data.topProduct
          ? `${data.topProduct.name} is leading tracked product revenue at ${formatMoney(data.topProduct.value)}. `
          : ""
      }${
        leadProtectCandidate
          ? `${topRiskName} is the stock line to protect operationally because the model is giving it a ${String(
              leadProtectCandidate.stockPolicyClass || "standard"
            )} protection policy, ${formatPercent(
              Number(leadProtectCandidate.stockoutProbability || 0) * 100
            )} stockout probability, and about ${formatMoney(
              Number(leadProtectCandidate.orderSpend || 0)
            )} in suggested spend.`
          : data.topRisk
            ? `${topRiskName} is the stock line to protect operationally because it is the lead availability risk.`
            : "Stock risk is calm enough that you can lean harder into merchandising and promotion."
      }`,
      highlights: [
        { label: "Protect", value: topRiskName },
        { label: "Push", value: topGrowthName },
        { label: "Top Category", value: data.reports.summary.topCategory || "No leader yet" },
        { label: "Low Stock", value: String(data.inventorySignals.lowStockCount) },
        ...(leadProtectCandidate
          ? [
              {
                label: "Protect Spend",
                value: formatMoney(Number(leadProtectCandidate.orderSpend || 0)),
              },
            ]
          : []),
      ],
      questionBack:
        "Do you want me to identify the exact SKU to protect first, the lines you can safely defer, or the category you should lean into next?",
      comparisons: [
        buildProductComparison(data.productInsights),
        buildReorderComparison(data.inventoryIntel.reorderNow),
      ].filter(Boolean),
      sources: ["sales", "reports", "inventory"],
    });
  }

  if (
    includesAny(query, [
      "what should i do first",
      "where should i focus",
      "what needs attention",
      "what matters most",
      "top priority",
      "priority today",
      "what should i focus on",
      "what do i do now",
    ])
  ) {
    const actionLines = [];

    if (data.topRisk) {
      actionLines.push(
        `${data.topRisk.name} is the first inventory action with ${data.topRisk.stock} units left and ${formatDaysCover(
          data.topRisk.estimatedDaysCover
        )}.`
      );
    }

    if (Number(data.overview.pendingOrders || 0) > 0 || Number(data.overview.declinedOrders || 0) > 0) {
      actionLines.push(
        `${Number(data.overview.pendingOrders || 0) + Number(data.overview.declinedOrders || 0)} orders are not cleanly resolved, leaving ${formatMoney(
          Number(data.overview.pendingRevenue || 0) + Number(data.overview.declinedRevenue || 0)
        )} exposed.`
      );
    }

    if (data.supplierLead) {
      actionLines.push(
        `${data.supplierLead.supplier} is the supplier carrying the highest current pressure across your at-risk SKUs.`
      );
    }

    if (!actionLines.length) {
      actionLines.push(
        "There is no dominant operational break right now, so focus on growing basket size and tightening promotions around your strongest category."
      );
    }

    return buildAssistantPayload({
      statusTone:
        Number(data.overview.pendingOrders || 0) > 0 || Number(data.inventorySignals.lowStockCount || 0) > 0
          ? "warning"
          : "success",
      headline: "Owner priority order",
      answer: actionLines.join(" "),
      highlights: [
        { label: "Lead Risk", value: data.topRisk?.name || "No urgent stock break" },
        { label: "Cash Exposed", value: formatMoney(Number(data.overview.pendingRevenue || 0) + Number(data.overview.declinedRevenue || 0)) },
        { label: "Top Supplier Risk", value: data.supplierLead?.supplier || "No elevated supplier risk" },
        { label: "Top Category", value: data.reports.summary.topCategory || "No leader yet" },
      ],
      questionBack:
        "Do you want the next step broken down by inventory, cash recovery, or supplier risk?",
      comparisons: [
        buildReorderComparison(data.inventoryIntel.reorderNow),
        buildCashExposureComparison(data),
        buildSupplierPressureComparison(data.inventoryIntel.supplierWatch),
      ].filter(Boolean),
      sources: ["inventory", "orders", "purchase orders", "reports"],
    });
  }

  return null;
}

function answerAiSignalsQuestion(question, data) {
  const signalIntent = detectAiSignalIntent(normalizeText(question));
  if (!signalIntent) return null;

  const aiSignals = buildAiSignalBundle(data);

  if (signalIntent === "daily-briefing") {
    const briefing = aiSignals.dailyBriefing;

    if (!briefing) {
      return buildAssistantPayload({
        statusTone: "warning",
        headline: "Daily briefing is not ready yet",
        answer:
          "The live workspace does not yet have enough grounded sales, inventory, and reporting data to assemble a reliable daily briefing.",
        highlights: [
          { label: "Revenue", value: formatMoney(data.overview.totalRevenue) },
          { label: "Orders", value: String(Number(data.overview.totalOrders || 0)) },
          { label: "Low Stock", value: String(Number(data.inventorySignals.lowStockCount || 0)) },
          { label: "Profit Coverage", value: formatPercent(data.reports.summary.profitCoverageRate || 0) },
        ],
        questionBack: "Do you want the current revenue picture, reorder queue, or supplier risk instead?",
        actions: buildNavigationActions([
          "dashboardCashPulse",
          "inventoryReorderPlanner",
          "suppliersService",
        ]),
        sources: ["sales", "inventory", "reports"],
      });
    }

    return buildAssistantPayload({
      statusTone: briefing.statusTone || "success",
      headline: briefing.headline || "Daily briefing",
      answer: [briefing.summary, briefing.whyItMatters, briefing.nextMove].filter(Boolean).join(" "),
      highlights: Array.isArray(briefing.contextCards)
        ? briefing.contextCards
            .slice(0, 4)
            .map((card) => ({
              label: String(card.label || "").trim(),
              value: String(card.value || "").trim(),
            }))
            .filter((card) => card.label && card.value)
        : [],
      questionBack:
        "Do you want me to break that down into restock priority, cash recovery, or supplier execution?",
      actions: buildNavigationActions([
        "dashboardCashPulse",
        "inventoryReorderPlanner",
        "suppliersService",
      ]),
      sources: ["sales", "inventory", "reports", "purchase orders"],
    });
  }

  if (signalIntent === "restock-suggestions") {
    const suggestions = aiSignals.restockSuggestions || [];
    const topSuggestion = suggestions[0] || null;

    if (!topSuggestion) {
      return buildAssistantPayload({
        statusTone: "success",
        headline: "No urgent restock suggestion is visible",
        answer:
          "No SKU is currently showing a dominant reorder signal from the live stock and sales history. Use this window to clean dormant lines and confirm inbound timing instead of placing emergency replenishment.",
        highlights: [
          { label: "Queue Size", value: String(Number(data.inventoryIntel.summary?.reorderNowCount || 0)) },
          { label: "Low Stock", value: String(Number(data.inventorySignals.lowStockCount || 0)) },
          {
            label: "Dormant Lines",
            value: String(Number(data.inventoryIntel.summary?.dormantStockCount || 0)),
          },
          { label: "Lead Supplier", value: data.supplierLead?.supplier || "No elevated supplier risk" },
        ],
        questionBack: "Do you want the dormant stock list, supplier risk ladder, or the full inventory directory?",
        actions: buildNavigationActions([
          "inventoryReorderPlanner",
          "suppliersRiskLadder",
          "inventoryDirectory",
        ]),
        comparisons: [buildSupplierPressureComparison(data.inventoryIntel.supplierWatch)].filter(Boolean),
        sources: ["inventory", "sales", "purchase orders"],
      });
    }

    return buildAssistantPayload({
      statusTone: "warning",
      headline: "Restock suggestions from live demand",
      answer: suggestions
        .slice(0, 3)
        .map(
          (item, index) =>
            `${index + 1}. ${item.name} from ${item.supplier} has ${item.stock} units left and ${formatDaysCover(
              item.estimatedDaysCover
            )}.`
        )
        .join(" "),
      highlights: [
        { label: "First SKU", value: topSuggestion.name },
        { label: "Lead Supplier", value: data.supplierLead?.supplier || topSuggestion.supplier },
        {
          label: "Queue Size",
          value: String(Number(data.inventoryIntel.summary?.reorderNowCount || suggestions.length)),
        },
        {
          label: "At-Risk Value",
          value: formatMoney(Number(data.inventoryIntel.summary?.atRiskInventoryValue || 0)),
        },
      ],
      questionBack:
        "Do you want that queue broken down by supplier, by urgency, or by the specific purchase orders covering it?",
      actions: buildNavigationActions([
        "inventoryReorderPlanner",
        "suppliersRiskLadder",
        "suppliersCommitments",
      ]),
      comparisons: [
        buildReorderComparison(data.inventoryIntel.reorderNow),
        buildSupplierPressureComparison(data.inventoryIntel.supplierWatch),
      ].filter(Boolean),
      sources: ["inventory", "sales", "purchase orders"],
    });
  }

  if (signalIntent === "risk-alerts") {
    const alerts = [];

    if (Number(data.reports.summary?.profitCoverageRate || 0) < 95) {
      alerts.push({
        label: "Margin Coverage",
        value: formatPercent(Number(data.reports.summary?.profitCoverageRate || 0)),
        note: `${formatMoney(Number(data.reports.summary?.uncostedRevenue || 0))} of revenue still lacks stored unit cost, so profit is only partially measured.`,
        tone: "warning",
      });
    }

    if (Number(data.suppliersIntel?.summary?.atRiskSuppliers || 0) > 0) {
      alerts.push({
        label: "Supplier Pressure",
        value: String(Number(data.suppliersIntel?.summary?.atRiskSuppliers || 0)),
        note: `${Number(data.suppliersIntel?.summary?.atRiskSuppliers || 0)} suppliers are on watch and ${formatMoney(
          Number(data.suppliersIntel?.summary?.openCommitmentValue || 0)
        )} is still tied up in open commitments.`,
        tone: "warning",
      });
    }

    alerts.push(...(aiSignals.riskAlerts || []));

    const statusTone = alerts.some((alert) => alert.tone === "danger")
      ? "danger"
      : alerts.some((alert) => alert.tone === "warning")
        ? "warning"
        : "success";

    return buildAssistantPayload({
      statusTone,
      headline: alerts.length ? "Live risk alerts" : "No material risk alert is visible right now",
      answer: alerts.length
        ? alerts
            .slice(0, 3)
            .map((alert) => `${alert.label}: ${alert.note}`)
            .join(" ")
        : "The current data does not show a cash, stock, or supplier condition severe enough to promote into the live alert stack.",
      highlights: [
        {
          label: "Cash Exposure",
          value: formatMoney(Number(data.overview.pendingRevenue || 0) + Number(data.overview.declinedRevenue || 0)),
        },
        { label: "Low Stock", value: String(Number(data.inventorySignals.lowStockCount || 0)) },
        { label: "Supplier Watch", value: String(Number(data.suppliersIntel?.summary?.atRiskSuppliers || 0)) },
        { label: "Profit Coverage", value: formatPercent(Number(data.reports.summary?.profitCoverageRate || 0)) },
      ],
      questionBack: "Do you want me to unpack the cash alert, the stock alert, or the supplier pressure first?",
      actions: buildNavigationActions([
        "dashboardCashPulse",
        "inventoryReorderPlanner",
        "suppliersRiskLadder",
      ]),
      comparisons: [
        buildCashExposureComparison(data),
        buildReorderComparison(data.inventoryIntel.reorderNow),
        buildSupplierPressureComparison(data.inventoryIntel.supplierWatch),
      ].filter(Boolean),
      sources: ["sales", "inventory", "reports", "purchase orders"],
    });
  }

  if (signalIntent === "anomaly-alerts") {
    const anomalyAlerts = aiSignals.anomalyAlerts || [];

    return buildAssistantPayload({
      statusTone:
        anomalyAlerts.some((item) => item.tone === "danger")
          ? "danger"
          : anomalyAlerts.some((item) => item.tone === "warning")
            ? "warning"
            : "success",
      headline: anomalyAlerts.length
        ? "Recent business anomalies from the live model"
        : "No material anomaly is visible right now",
      answer: anomalyAlerts.length
        ? anomalyAlerts
            .slice(0, 3)
            .map(
              (item) =>
                `${item.headline}: ${item.summary || `${item.metric} moved ${item.deviationPercent}% away from baseline.`}`
            )
            .join(" ")
        : "The rolling revenue, order, refund, decline, and paid-conversion baselines are not showing a material anomaly in the recent window.",
      highlights: anomalyAlerts.length
        ? anomalyAlerts.slice(0, 4).map((item) => ({
            label: item.metric || "signal",
            value: `${Number(item.deviationPercent || 0).toFixed(1)}%`,
          }))
        : [
            { label: "Alert Count", value: "0" },
            { label: "Model Window", value: "42 days" },
            { label: "Baseline", value: "7 days" },
            { label: "Status", value: "Stable" },
          ],
      questionBack:
        "Do you want me to unpack the revenue anomaly, the refund spike, or the paid conversion shift first?",
      actions: buildNavigationActions([
        "reportsRunway",
        "dashboardCashPulse",
        "reportsCategoryConcentration",
      ]),
      sources: ["sales", "reports", "forecasting"],
    });
  }

  if (signalIntent === "demand-forecast") {
    const model = data.machineForecast || {};
    const nextProjection = model.periods?.[0] || null;
    const secondProjection = model.periods?.[1] || null;
    const nextLower = Number(nextProjection?.projectedRevenueLower || 0);
    const nextUpper = Number(nextProjection?.projectedRevenueUpper || 0);

    return buildAssistantPayload({
      statusTone:
        Number(model.modelSummary?.confidenceScore || 0) >= 65
          ? "success"
          : Number(model.modelSummary?.confidenceScore || 0) >= 45
            ? "warning"
            : "danger",
      headline: nextProjection
        ? "Demand forecast from the live model"
        : "Forecast data is still building",
      answer: nextProjection
        ? `The model projects ${formatMoney(
            Number(nextProjection.projectedRevenue || 0)
          )} across ${Number(nextProjection.projectedOrders || 0)} orders for ${
            nextProjection.label
          }, with an 80% planning band of ${formatMoney(nextLower)} to ${formatMoney(nextUpper)}. ${
            secondProjection
              ? `The following period is projected at ${formatMoney(
                  Number(secondProjection.projectedRevenue || 0)
                )}.`
              : ""
          }`
        : "The forecast engine needs more stable reporting history before it can return a meaningful projection.",
      highlights: [
        { label: "Model Confidence", value: String(Number(model.modelSummary?.confidenceScore || 0)) },
        {
          label: "Revenue Error",
          value:
            model.overview?.revenueWape === null || model.overview?.revenueWape === undefined
              ? "n/a"
              : formatPercent(Number(model.overview.revenueWape || 0)),
        },
        { label: "Planning Days", value: String(Number(model.overview?.planningDays || 0)) },
        {
          label: "Stockout Risks",
          value: String(Number(model.modelSummary?.stockoutRiskCount || 0)),
        },
      ],
      questionBack:
        "Do you want the forecast unpacked into uncertainty bands, stockout risk, or promotion opportunities?",
      actions: buildNavigationActions([
        "reportsRunway",
        "inventoryReorderPlanner",
        "dashboardDemandDrivers",
      ]),
      sources: ["sales", "reports", "forecasting"],
    });
  }

  if (signalIntent === "forecast-uncertainty") {
    const model = data.machineForecast || {};
    const nextProjection = model.periods?.[0] || null;
    const secondProjection = model.periods?.[1] || null;

    return buildAssistantPayload({
      statusTone:
        Number(model.modelSummary?.confidenceScore || 0) >= 70
          ? "success"
          : Number(model.modelSummary?.confidenceScore || 0) >= 50
            ? "warning"
            : "danger",
      headline: nextProjection ? "Forecast uncertainty band" : "Forecast interval is not available yet",
      answer: nextProjection
        ? `${nextProjection.label} is centered at ${formatMoney(
            Number(nextProjection.projectedRevenue || 0)
          )} with an 80% planning band of ${formatMoney(
            Number(nextProjection.projectedRevenueLower || 0)
          )} to ${formatMoney(Number(nextProjection.projectedRevenueUpper || 0))}. ${
            secondProjection
              ? `${secondProjection.label} follows with a band of ${formatMoney(
                  Number(secondProjection.projectedRevenueLower || 0)
                )} to ${formatMoney(Number(secondProjection.projectedRevenueUpper || 0))}.`
              : ""
          }`
        : "The model needs a stable enough history before it can estimate a usable forecast interval.",
      highlights: [
        {
          label: "Interval",
          value: String(model.overview?.predictionInterval || "n/a"),
        },
        {
          label: "Confidence",
          value: String(Number(model.modelSummary?.confidenceScore || 0)),
        },
        {
          label: "Revenue WAPE",
          value:
            model.overview?.revenueWape === null || model.overview?.revenueWape === undefined
              ? "n/a"
              : formatPercent(Number(model.overview.revenueWape || 0)),
        },
        {
          label: "Orders WAPE",
          value:
            model.overview?.ordersWape === null || model.overview?.ordersWape === undefined
              ? "n/a"
              : formatPercent(Number(model.overview.ordersWape || 0)),
        },
      ],
      questionBack:
        "Do you want that uncertainty connected to risky SKUs, to next-week cash exposure, or to supplier lead-time pressure?",
      actions: buildNavigationActions([
        "reportsRunway",
        "inventoryReorderPlanner",
        "suppliersRiskLadder",
      ]),
      sources: ["sales", "reports", "forecasting"],
    });
  }

  if (signalIntent === "model-foundation") {
    const foundation = data.machineForecast?.dataFoundation || {};
    const counts = foundation.entityCounts || {};
    const coverage = foundation.coverage || {};

    return buildAssistantPayload({
      statusTone:
        Number(foundation.richnessScore || 0) >= 72
          ? "success"
          : Number(foundation.richnessScore || 0) >= 48
            ? "warning"
            : "danger",
      headline: "What the model is actually learning from",
      answer: `The ML foundation is not just products. Products are the reference catalog, but the model is mainly learning from ${Number(
        counts.sales || 0
      )} sales, ${Number(counts.saleItems || 0)} sale-line observations, ${Number(
        counts.purchaseOrders || 0
      )} purchase orders, ${Number(counts.inventoryMovements || 0)} inventory movements, and ${Number(
        counts.cycleCounts || 0
      )} cycle counts, then using customers, suppliers, and staff context to shape demand quality and operational risk. ${
        foundation.narrative || ""
      }`,
      highlights: [
        { label: "Richness", value: String(Number(foundation.richnessScore || 0)) },
        { label: "History Days", value: String(Number(foundation.historyDays || 0)) },
        { label: "Sales", value: String(Number(counts.sales || 0)) },
        {
          label: "Movement Coverage",
          value: formatPercent(Number(coverage.movementCoverageRate || 0)),
        },
      ],
      questionBack:
        "Do you want me to break that foundation down into demand history, supplier history, or stock-integrity coverage first?",
      actions: buildNavigationActions([
        "reportsRunway",
        "inventoryReorderPlanner",
        "suppliersRiskLadder",
      ]),
      sources: ["sales", "inventory", "purchase orders", "cycle counts", "forecasting"],
    });
  }

  if (signalIntent === "model-confidence") {
    const model = data.machineForecast || {};

    return buildAssistantPayload({
      statusTone:
        Number(model.modelSummary?.confidenceScore || 0) >= 65
          ? "success"
          : Number(model.modelSummary?.confidenceScore || 0) >= 45
            ? "warning"
            : "danger",
      headline: "Forecast confidence and error profile",
      answer: `The current model confidence score is ${Number(
        model.modelSummary?.confidenceScore || 0
      )}. ${
        model.overview?.revenueWape === null || model.overview?.revenueWape === undefined
          ? "Holdout revenue error is not measurable yet because the series is still thin."
          : `Holdout revenue WAPE is ${formatPercent(Number(model.overview.revenueWape || 0))} and order WAPE is ${formatPercent(
              Number(model.overview.ordersWape || 0)
            )}.`
      } The model is currently using ${String(
        model.overview?.predictionInterval || "n/a"
      )} planning bands. Higher confidence comes from deeper history, more observed selling days, lower holdout error, and better lead-time evidence.`,
      highlights: [
        { label: "Confidence", value: String(Number(model.modelSummary?.confidenceScore || 0)) },
        {
          label: "Avg SKU Confidence",
          value: String(Number(model.modelSummary?.averageSkuConfidence || 0)),
        },
        {
          label: "Revenue WAPE",
          value:
            model.overview?.revenueWape === null || model.overview?.revenueWape === undefined
              ? "n/a"
              : formatPercent(Number(model.overview.revenueWape || 0)),
        },
        {
          label: "Orders WAPE",
          value:
            model.overview?.ordersWape === null || model.overview?.ordersWape === undefined
              ? "n/a"
              : formatPercent(Number(model.overview.ordersWape || 0)),
        },
        {
          label: "Interval",
          value: String(model.overview?.predictionInterval || "n/a"),
        },
      ],
      questionBack:
        "Do you want the confidence score connected to the next revenue projection, the interval width, or the risky SKUs first?",
      actions: buildNavigationActions([
        "reportsRunway",
        "reportsCategoryConcentration",
        "inventoryReorderPlanner",
      ]),
      sources: ["sales", "reports", "forecasting"],
    });
  }

  if (signalIntent === "stockout-risk") {
    const risks = data.machineForecast?.stockoutRisks || [];
    const leadRisk = risks[0] || null;

    return buildAssistantPayload({
      statusTone:
        risks.some((item) => String(item.riskLevel || "") === "critical")
          ? "danger"
          : risks.length
            ? "warning"
            : "success",
      headline: risks.length ? "Model-led stockout risk queue" : "No immediate stockout risk is visible",
      answer: risks.length
        ? risks
            .slice(0, 3)
            .map(
              (item, index) =>
                `${index + 1}. ${item.name} is ${item.riskLevel} risk with ${
                  item.projectedStockoutDays === null
                    ? "unmeasured cover"
                    : `${Number(item.projectedStockoutDays).toFixed(1)} days of projected cover`
                }, about ${formatPercent(Number(item.stockoutProbability || 0) * 100)} stockout probability, a ${String(
                  item.stockPolicyClass || "standard"
                )} protection policy, and a recommended order of ${Number(item.recommendedOrderQty || 0)} units.`
            )
            .join(" ")
        : "The current model does not see a SKU heading into a meaningful stockout window right now.",
      highlights: [
        { label: "Risk Count", value: String(risks.length) },
        { label: "Lead SKU", value: leadRisk?.name || "None" },
        { label: "Lead Supplier", value: leadRisk?.supplier || "None" },
        {
          label: "Lead Order Qty",
          value: String(Number(leadRisk?.recommendedOrderQty || 0)),
        },
        {
          label: "Lead Policy",
          value: leadRisk?.stockPolicyClass || "n/a",
        },
        {
          label: "Lead Probability",
          value: leadRisk ? formatPercent(Number(leadRisk.stockoutProbability || 0) * 100) : "n/a",
        },
      ],
      questionBack:
        "Do you want that risk ladder broken down by supplier, by urgency, by lead-time pressure, or by which SKU can still be promoted safely?",
      actions: buildNavigationActions([
        "inventoryReorderPlanner",
        "suppliersRiskLadder",
        "suppliersCommitments",
      ]),
      comparisons: [
        buildReorderComparison(data.inventoryIntel.reorderNow),
        buildSupplierPressureComparison(data.inventoryIntel.supplierWatch),
      ].filter(Boolean),
      sources: ["inventory", "sales", "purchase orders", "forecasting"],
    });
  }

  if (signalIntent === "lead-time-pressure") {
    const risks = data.machineForecast?.stockoutRisks || [];
    const supplierSignals = data.machineForecast?.supplierSignals || [];
    const withLeadTimes = [...(data.machineForecast?.restockRecommendations || [])]
      .filter((item) => Number(item?.leadTimeP90Days || item?.leadTimeDays || 0) > 0)
      .sort(
        (left, right) =>
          Number(right?.leadTimeP90Days || right?.leadTimeDays || 0) -
            Number(left?.leadTimeP90Days || left?.leadTimeDays || 0) ||
          Number(right?.stockoutProbability || 0) - Number(left?.stockoutProbability || 0)
      );
    const lead = withLeadTimes[0] || null;
    const leadSupplier = supplierSignals[0] || null;

    return buildAssistantPayload({
      statusTone:
        risks.some((item) => String(item.riskLevel || "") === "critical")
          ? "danger"
          : withLeadTimes.length
            ? "warning"
            : "success",
      headline: lead ? "Lead-time pressure from the replenishment model" : "Lead-time pressure is calm",
      answer: lead
        ? withLeadTimes
            .slice(0, 3)
            .map(
              (item, index) =>
                `${index + 1}. ${item.name} is planning against roughly ${Number(
                  item.leadTimeDays || 0
                ).toFixed(1)} mean lead-time days and ${Number(
                  item.leadTimeP90Days || item.leadTimeDays || 0
                ).toFixed(1)} days at the upper planning edge, with ${formatPercent(
                  Number(item.stockoutProbability || 0) * 100
                )} stockout probability.`
            )
            .join(" ") +
          (leadSupplier
            ? ` ${leadSupplier.supplier} is the supplier carrying the strongest execution drag at ${Number(
                leadSupplier.weightedRiskScore || 0
              )}/100 weighted risk, with ${Number(leadSupplier.openOrders || 0)} open orders and ${Number(
                leadSupplier.lateOpenOrders || 0
              )} already late commitments.`
            : "")
        : "The current model is not seeing meaningful supplier-delay pressure in the visible reorder set right now.",
      highlights: [
        { label: "Tracked Risks", value: String(risks.length) },
        { label: "Lead SKU", value: lead?.name || "None" },
        { label: "Lead Supplier", value: leadSupplier?.supplier || "None" },
        {
          label: "Lead Time P90",
          value: lead ? `${Number(lead.leadTimeP90Days || lead.leadTimeDays || 0).toFixed(1)}d` : "n/a",
        },
        {
          label: "Lead Probability",
          value: lead ? formatPercent(Number(lead.stockoutProbability || 0) * 100) : "n/a",
        },
      ],
      questionBack:
        "Do you want me to connect that delay pressure to supplier exposure, reorder quantities, or the forecast uncertainty band?",
      actions: buildNavigationActions([
        "suppliersRiskLadder",
        "suppliersCommitments",
        "inventoryReorderPlanner",
      ]),
      sources: ["purchase orders", "inventory", "sales", "forecasting"],
    });
  }

  if (signalIntent === "promotion-opportunities") {
    const opportunities = data.machineForecast?.promotionCandidates || [];
    const leadOpportunity = opportunities[0] || null;

    return buildAssistantPayload({
      statusTone: opportunities.length ? "success" : "warning",
      headline: opportunities.length
        ? "Promotion opportunities from the live model"
        : "No clean promotion candidate is obvious right now",
      answer: opportunities.length
        ? opportunities
            .slice(0, 3)
            .map(
              (item, index) =>
                `${index + 1}. ${item.name} has ${item.currentStock} units available, ${formatPercent(
                  item.grossMarginPct
                )} gross margin, and a ${item.trendDirection} demand trend.`
            )
            .join(" ")
        : "The model is not seeing a SKU with enough stock buffer, confidence, and margin quality to recommend as a clean push candidate right now.",
      highlights: [
        { label: "Opportunity Count", value: String(opportunities.length) },
        { label: "Lead Candidate", value: leadOpportunity?.name || "None" },
        {
          label: "Lead Margin",
          value: leadOpportunity ? formatPercent(leadOpportunity.grossMarginPct) : "n/a",
        },
        {
          label: "Lead Confidence",
          value: leadOpportunity ? String(Number(leadOpportunity.confidenceScore || 0)) : "n/a",
        },
      ],
      questionBack:
        "Do you want to compare those opportunities against stockout risk or against the strongest category demand?",
      actions: buildNavigationActions([
        "dashboardDemandDrivers",
        "reportsCategoryConcentration",
        "inventoryReorderPlanner",
      ]),
      sources: ["sales", "inventory", "reports", "forecasting"],
    });
  }

  const insightTone = (aiSignals.salesInsights || []).some((item) => item.type === "negative")
    ? "danger"
    : (aiSignals.salesInsights || []).some((item) => item.type === "warning")
      ? "warning"
      : "success";

  return buildAssistantPayload({
    statusTone: insightTone,
    headline: (aiSignals.salesInsights || []).length ? "Grounded sales insights" : "Sales insights are still forming",
    answer: (aiSignals.salesInsights || []).length
      ? aiSignals.salesInsights
          .slice(0, 3)
          .map((item) => `${item.title}: ${item.message}`)
          .join(" ")
      : "Sales insights will sharpen as more paid orders, category concentration, and repeat demand history build up in the database.",
    highlights: [
      { label: "Revenue", value: formatMoney(Number(data.overview.totalRevenue || 0)) },
      { label: "Orders", value: String(Number(data.overview.totalOrders || 0)) },
      { label: "Top Category", value: data.reports.summary?.topCategory || "No leader yet" },
      {
        label: "Top Product",
        value: data.reports.summary?.topProduct || data.topProduct?.name || "No clear leader yet",
      },
    ],
    questionBack:
      "Do you want category concentration, the lead product, or the strongest trading window behind those insights?",
    actions: buildNavigationActions([
      "reportsRunway",
      "reportsCategoryConcentration",
      "dashboardDemandDrivers",
    ]),
    comparisons: [
      buildCategoryComparison(data.reports.categoryBreakdown),
      buildProductComparison(data.productInsights),
    ].filter(Boolean),
    sources: ["sales", "reports", "inventory", "customers"],
  });
}

function answerInventoryQuestion(question, data, history = []) {
  const matchedProduct = findMentionedProduct(question, data, history);
  const matchedSupplier = findMentionedSupplier(question, data, history);
  const query = normalizeText(question);

  if (matchedSupplier?.supplier) {
    const supplierRisk = getSupplierRiskDetails(matchedSupplier.supplier, data);

    return buildAssistantPayload({
      statusTone: supplierRisk.statusTone,
      headline: `${matchedSupplier.supplier} supplier position`,
      answer: `${supplierRisk.answer} ${
        supplierRisk.supplierSkuCount
          ? `${matchedSupplier.supplier} currently supplies ${supplierRisk.supplierSkuCount} tracked SKUs, or ${formatPercent(
              supplierRisk.supplierShare
            )} of the recorded assortment.`
          : ""
      }`,
      highlights: [
        { label: "At-Risk Products", value: String(supplierRisk.pressuredSkus.length) },
        { label: "Lead SKU", value: supplierRisk.leadSku?.name || "None" },
        {
          label: "Avg Lead Time",
          value:
            supplierRisk.serviceMetrics.averageLeadTimeDays === null
              ? "No received history"
              : `${supplierRisk.serviceMetrics.averageLeadTimeDays.toFixed(1)} days`,
        },
        {
          label: "Fill Rate",
          value:
            supplierRisk.serviceMetrics.fillRate === null
              ? "No ordered units"
              : formatPercent(supplierRisk.serviceMetrics.fillRate),
        },
      ],
      questionBack: `Do you want me to identify which SKUs tied to ${matchedSupplier.supplier} need the fastest action or show the purchase orders covering them?`,
      actions: buildNavigationActions([
        "suppliersRiskLadder",
        "suppliersCommitments",
        "inventoryReorderPlanner",
      ]),
      comparisons: [
        buildComparisonTable(
          `${matchedSupplier.supplier} SKU Exposure`,
          ["SKU", "Stock", "Cover", "Urgency"],
          supplierRisk.pressuredSkus.slice(0, 5).map((item) => [
            item.name,
            String(Number(item.stock || 0)),
            formatDaysCover(item.estimatedDaysCover),
            item.status || "Watch",
          ]),
          "At-risk SKUs currently concentrated with this supplier."
        ),
        buildSupplierServiceComparison(matchedSupplier.supplier, supplierRisk.supplierOrders),
        buildPurchaseOrderComparison(supplierRisk.supplierOrders),
      ].filter(Boolean),
      drilldowns: [
        buildDrilldown(
          "Trace supplier exposure",
          "Start with the supplier risk ladder, move into the open commitments table, then confirm which SKUs still depend on that supplier.",
          ["suppliersRiskLadder", "suppliersCommitments", "inventoryReorderPlanner"]
        ),
      ].filter(Boolean),
      sources: ["inventory", "purchase orders"],
    });
  }

  if (matchedProduct) {
    const reorderCandidate = data.inventoryIntel.reorderNow.find(
      (item) => normalizeText(item.name) === normalizeText(matchedProduct.name)
    );
    const stockRisk = matchedProduct.stock <= 5 ? "critical" : matchedProduct.stock <= 10 ? "tight" : "healthy";

    if (includesAny(query, ["reorder", "restock", "buy more", "order more", "should i buy"])) {
      return buildAssistantPayload({
        statusTone: reorderCandidate || matchedProduct.stock <= 10 ? "warning" : "success",
        headline: `${matchedProduct.name} reorder decision`,
        answer:
          reorderCandidate || matchedProduct.stock <= 10
            ? `Yes. ${matchedProduct.name} should stay in the reorder queue. It has ${matchedProduct.stock} units on hand${
                reorderCandidate
                  ? ` with ${formatDaysCover(reorderCandidate.estimatedDaysCover)} and a ${reorderCandidate.status.toLowerCase()} urgency signal`
                  : ""
              }.`
            : `Not immediately. ${matchedProduct.name} still looks healthy with ${matchedProduct.stock} units on hand and is not the lead stock pressure right now.`,
        highlights: [
          { label: "On Hand", value: String(matchedProduct.stock) },
          { label: "Units Sold", value: String(matchedProduct.unitsSold) },
          { label: "Supplier", value: matchedProduct.supplier },
          {
            label: "Queue Status",
            value: reorderCandidate ? reorderCandidate.status : "Not in urgent queue",
          },
        ],
        questionBack: `Do you want me to compare ${matchedProduct.name} against the top reorder SKU or check the supplier risk behind it?`,
        comparisons: [
          buildProductComparison([
            matchedProduct,
            ...data.productInsights.filter((item) => normalizeText(item.name) !== normalizeText(matchedProduct.name)),
          ]),
          buildReorderComparison(data.inventoryIntel.reorderNow),
        ].filter(Boolean),
        sources: ["inventory", "sales", "purchase orders"],
      });
    }

    if (includesAny(query, ["promote", "push", "feature"])) {
      return buildAssistantPayload({
        statusTone:
          matchedProduct.stock <= 10
            ? "warning"
            : matchedProduct.unitsSold > 0
            ? "success"
            : "neutral",
        headline: `${matchedProduct.name} promotion fit`,
        answer:
          matchedProduct.stock <= 10
            ? `${matchedProduct.name} is selling, but stock is too tight at ${matchedProduct.stock} units to treat it as a safe promotion lead until supply is reinforced.`
            : matchedProduct.unitsSold > 0
            ? `${matchedProduct.name} is a reasonable product to push because it has ${matchedProduct.stock} units on hand and already shows ${matchedProduct.unitsSold} units sold.`
            : `${matchedProduct.name} has stock available, but it has not yet proven enough demand to be the first promotion choice.`,
        highlights: [
          { label: "On Hand", value: String(matchedProduct.stock) },
          { label: "Units Sold", value: String(matchedProduct.unitsSold) },
          { label: "Revenue", value: formatMoney(matchedProduct.revenue) },
          { label: "Category", value: matchedProduct.category },
        ],
        questionBack: `Do you want me to suggest a stronger product to push than ${matchedProduct.name}?`,
        comparisons: [
          buildProductComparison([
            matchedProduct,
            ...data.productInsights.filter((item) => normalizeText(item.name) !== normalizeText(matchedProduct.name)),
          ]),
        ].filter(Boolean),
        sources: ["inventory", "sales"],
      });
    }

    return buildAssistantPayload({
      statusTone: matchedProduct.stock <= 10 ? "warning" : "success",
      headline: `${matchedProduct.name} inventory position`,
      answer: `${matchedProduct.name} is in ${stockRisk} inventory territory with ${
        matchedProduct.stock
      } units on hand. It has generated ${formatMoney(matchedProduct.revenue)} from ${
        matchedProduct.unitsSold
      } units sold, and the current supplier on record is ${matchedProduct.supplier}.`,
      highlights: [
        { label: "On Hand", value: String(matchedProduct.stock) },
        { label: "Units Sold", value: String(matchedProduct.unitsSold) },
        { label: "Revenue", value: formatMoney(matchedProduct.revenue) },
        { label: "Supplier", value: matchedProduct.supplier },
      ],
      questionBack: `Do you want me to compare ${matchedProduct.name} against the reorder queue or tell you whether it is tying up too much cash?`,
      comparisons: [
        buildProductComparison([
          matchedProduct,
          ...data.productInsights.filter((item) => normalizeText(item.name) !== normalizeText(matchedProduct.name)),
        ]),
        buildReorderComparison(data.inventoryIntel.reorderNow),
      ].filter(Boolean),
      sources: ["inventory", "sales", "purchase orders"],
    });
  }

  return buildAssistantPayload({
    statusTone: data.topRisk && Number(data.topRisk.stock || 0) <= 10 ? "warning" : "success",
    headline: "Inventory priority",
    answer: data.topRisk
      ? `${data.topRisk.name} is the clearest inventory priority with ${Number(
          data.topRisk.stock || 0
        )} units on hand. ${
          data.supplierLead
            ? `${data.supplierLead.supplier} is carrying the most supplier pressure. `
            : ""
        }${
          data.dormantLead
            ? `${data.dormantLead.name} is also tying up ${formatMoney(
                data.dormantLead.stockValue
              )} as dormant stock.`
            : "Dormant stock is not the lead issue right now."
        }`
      : "No dominant inventory risk is visible right now. Use this window to clean dormant stock and supplier pacing.",
    highlights: [
      { label: "Low Stock", value: String(data.inventorySignals.lowStockCount) },
      { label: "Reorder Queue", value: String(data.inventoryIntel.summary.reorderNowCount || 0) },
      { label: "Dormant Stock", value: String(data.inventoryIntel.summary.dormantStockCount || 0) },
      { label: "At-Risk Value", value: formatMoney(data.inventoryIntel.summary.atRiskInventoryValue) },
    ],
    questionBack:
      "Do you want me to focus next on reorder priority, dormant stock, or supplier risk?",
    comparisons: [
      buildReorderComparison(data.inventoryIntel.reorderNow),
      buildSupplierPressureComparison(data.inventoryIntel.supplierWatch),
    ].filter(Boolean),
    sources: ["inventory", "purchase orders", "sales"],
  });
}

function answerSuppliersQuestion(question, data, history = []) {
  const query = normalizeText(question);
  const suppliersIntel = data.suppliersIntel || {};
  const summary = suppliersIntel.summary || {};
  const executiveSummary = suppliersIntel.executiveSummary || {};
  const topSupplier = suppliersIntel.topSuppliers?.[0] || suppliersIntel.suppliers?.[0] || null;
  const matchedSupplier = findMentionedSupplier(question, data, history);

  if (matchedSupplier?.supplier) {
    const supplierRisk = getSupplierRiskDetails(matchedSupplier.supplier, data);
    const supplierRecord =
      (suppliersIntel.suppliers || []).find(
        (item) => normalizeText(item.supplier) === normalizeText(matchedSupplier.supplier)
      ) || null;

    return buildAssistantPayload({
      statusTone: supplierRisk.statusTone,
      headline: `${matchedSupplier.supplier} supplier position`,
      answer: `${supplierRisk.answer} ${
        supplierRecord
          ? `${matchedSupplier.supplier} is carrying a ${supplierRecord.serviceScore}/100 supplier service score with ${
              supplierRecord.openPoCount
            } open commitments and ${supplierRecord.lateOrders} late orders.`
          : ""
      }`,
      highlights: [
        { label: "At-Risk SKUs", value: String(supplierRisk.pressuredSkus.length) },
        { label: "Open POs", value: String(supplierRisk.openOrders.length) },
        {
          label: "Fill Rate",
          value:
            supplierRisk.serviceMetrics.fillRate === null
              ? "No ordered units"
              : formatPercent(supplierRisk.serviceMetrics.fillRate),
        },
        {
          label: "Service Score",
          value: supplierRecord ? `${supplierRecord.serviceScore}/100` : "Not scored yet",
        },
      ],
      questionBack: `Do you want the specific purchase orders for ${matchedSupplier.supplier}, the exposed SKUs, or the service board comparison?`,
      actions: buildNavigationActions([
        "suppliersService",
        "suppliersCommitments",
        "suppliersRiskLadder",
      ]),
      comparisons: [
        buildSupplierServiceBoardComparison(
          [
            ...(supplierRecord ? [supplierRecord] : []),
            ...(suppliersIntel.suppliers || []).filter(
              (item) => normalizeText(item.supplier) !== normalizeText(matchedSupplier.supplier)
            ),
          ],
          5
        ),
        buildComparisonTable(
          `${matchedSupplier.supplier} SKU exposure`,
          ["SKU", "Stock", "Cover", "Urgency"],
          supplierRisk.pressuredSkus.slice(0, 5).map((item) => [
            item.name,
            String(Number(item.stock || 0)),
            formatDaysCover(item.estimatedDaysCover),
            item.status || "Watch",
          ]),
          "Products currently depending on this supplier."
        ),
        buildPurchaseOrderComparison(supplierRisk.supplierOrders),
      ].filter(Boolean),
      drilldowns: [
        buildDrilldown(
          "Follow supplier execution",
          "Start with the supplier service board, then inspect the open commitments, then confirm which SKUs are still exposed to that supplier.",
          ["suppliersService", "suppliersCommitments", "suppliersRiskLadder"]
        ),
      ].filter(Boolean),
      sources: ["suppliers", "purchase orders", "inventory"],
    });
  }

  if (
    includesAny(query, [
      "fill rate",
      "lead time",
      "service",
      "service score",
      "service quality",
      "vendor performance",
      "supplier performance",
    ])
  ) {
    return buildAssistantPayload({
      statusTone: executiveSummary.statusTone || "success",
      headline: executiveSummary.headline || "Supplier service quality",
      answer: `Weighted fill rate is ${formatPercent(summary.weightedFillRate || 0)} and average lead time is ${
        Number(summary.averageLeadTime || 0) > 0
          ? `${Number(summary.averageLeadTime || 0).toFixed(1)} days`
          : "not measurable yet from received purchase orders"
      }. ${executiveSummary.whyItMatters || ""} ${executiveSummary.nextMove || ""}`.trim(),
      highlights: [
        { label: "Fill Rate", value: formatPercent(summary.weightedFillRate || 0) },
        {
          label: "Lead Time",
          value:
            Number(summary.averageLeadTime || 0) > 0
              ? `${Number(summary.averageLeadTime || 0).toFixed(1)} days`
              : "No received history",
        },
        { label: "At-Risk Suppliers", value: String(Number(summary.atRiskSuppliers || 0)) },
        { label: "Lead Supplier", value: summary.leadSupplier || "No clear watchpoint" },
      ],
      questionBack:
        "Do you want the lead supplier broken down, the open commitments table, or the full supplier directory?",
      actions: buildNavigationActions([
        "suppliersService",
        "suppliersCommitments",
        "suppliersDirectory",
      ]),
      comparisons: [
        buildSupplierServiceBoardComparison(suppliersIntel.topSuppliers || suppliersIntel.suppliers || []),
        buildSupplierPressureComparison(data.inventoryIntel.supplierWatch),
      ].filter(Boolean),
      sources: ["suppliers", "purchase orders", "inventory"],
    });
  }

  if (
    includesAny(query, [
      "commitment",
      "commitments",
      "late order",
      "late orders",
      "late commitment",
      "late commitments",
      "open supplier orders",
      "open commitments",
      "receipt",
      "receipts",
      "inbound",
    ])
  ) {
    const topOpenOrder = suppliersIntel.openOrders?.[0] || null;

    return buildAssistantPayload({
      statusTone:
        Number(summary.lateCommitments || 0) > 0 || Number(summary.openPoCount || 0) > 0
          ? "warning"
          : "success",
      headline: "Supplier commitments and inbound execution",
      answer: `${formatMoney(summary.openCommitmentValue || 0)} is still sitting in ${
        summary.openPoCount || 0
      } open supplier commitments. ${
        topOpenOrder
          ? `${topOpenOrder.supplier} has the largest live commitment at ${formatMoney(topOpenOrder.value)}. `
          : ""
      }${
        Number(summary.lateCommitments || 0) > 0
          ? `${summary.lateCommitments} supplier commitments are already late and need follow-through.`
          : "No supplier commitment is currently late."
      }`,
      highlights: [
        { label: "Open Value", value: formatMoney(summary.openCommitmentValue || 0) },
        { label: "Open POs", value: String(Number(summary.openPoCount || 0)) },
        { label: "Late Orders", value: String(Number(summary.lateCommitments || 0)) },
        { label: "Lead Supplier", value: topOpenOrder?.supplier || summary.leadSupplier || "No clear watchpoint" },
      ],
      questionBack:
        "Do you want the biggest open commitment, the supplier risk ladder, or the service board behind those commitments?",
      actions: buildNavigationActions([
        "suppliersCommitments",
        "suppliersRiskLadder",
        "suppliersService",
      ]),
      comparisons: [
        buildPurchaseOrderComparison(data.purchaseOrders),
        buildSupplierServiceBoardComparison(suppliersIntel.topSuppliers || suppliersIntel.suppliers || []),
        buildSupplierPressureComparison(data.inventoryIntel.supplierWatch),
      ].filter(Boolean),
      sources: ["suppliers", "purchase orders", "inventory"],
    });
  }

  return buildAssistantPayload({
    statusTone: executiveSummary.statusTone || "success",
    headline: executiveSummary.headline || "Supplier operating picture",
    answer: `${executiveSummary.summary || "Supplier intelligence is live from the current purchase-order and inventory history."} ${
      executiveSummary.whyItMatters || ""
    } ${executiveSummary.nextMove || ""}`.trim(),
    highlights: [
      { label: "Lead Supplier", value: summary.leadSupplier || topSupplier?.supplier || "No clear watchpoint" },
      { label: "At-Risk Suppliers", value: String(Number(summary.atRiskSuppliers || 0)) },
      { label: "Fill Rate", value: formatPercent(summary.weightedFillRate || 0) },
      { label: "Open Value", value: formatMoney(summary.openCommitmentValue || 0) },
    ],
    questionBack:
      "Do you want the lead supplier risk, the open commitments table, or the supplier service board next?",
    actions: buildNavigationActions([
      "suppliersService",
      "suppliersCommitments",
      "suppliersRiskLadder",
    ]),
    comparisons: [
      buildSupplierServiceBoardComparison(suppliersIntel.topSuppliers || suppliersIntel.suppliers || []),
      buildSupplierPressureComparison(data.inventoryIntel.supplierWatch),
      buildPurchaseOrderComparison(data.purchaseOrders),
    ].filter(Boolean),
    sources: ["suppliers", "purchase orders", "inventory"],
  });
}

function answerOrdersQuestion(question, data, history = []) {
  const matchedCashier = findMentionedCashier(question, data, history);

  if (matchedCashier) {
    return buildAssistantPayload({
      headline: `${matchedCashier.cashier} checkout performance`,
      answer: `${matchedCashier.cashier} has processed ${matchedCashier.orders} orders for ${formatMoney(
        matchedCashier.revenue
      )} in revenue, with an average basket of ${formatMoney(
        matchedCashier.averageOrderValue
      )}. Use that flow as the benchmark for the rest of the front desk team.`,
      highlights: [
        { label: "Orders", value: String(matchedCashier.orders) },
        { label: "Revenue", value: formatMoney(matchedCashier.revenue) },
        { label: "Avg Basket", value: formatMoney(matchedCashier.averageOrderValue) },
      ],
      questionBack: `Do you want me to compare ${matchedCashier.cashier} against checkout friction, payment mix, or the strongest trading window?`,
      comparisons: [
        buildCashierComparison(data.topCashiers),
        buildPaymentComparison(data.paymentMethodBreakdown),
      ].filter(Boolean),
      sources: ["orders", "sales", "staff"],
    });
  }

  const topPayment = data.topPaymentMethod || null;
  const topChannel = data.topChannel || null;
  const bestTradingWindow = data.bestTradingWindow || null;

  return buildAssistantPayload({
    statusTone: data.overview.pendingOrders > 0 || data.overview.declinedOrders > 0 ? "warning" : "success",
    headline: "Order flow and checkout quality",
    answer: `Paid conversion is ${formatPercent(data.overview.paidRate)} with ${
      data.overview.pendingOrders
    } pending orders and ${data.overview.declinedOrders} declined orders. ${
      bestTradingWindow
        ? `${bestTradingWindow.label} is the strongest trading window at ${formatMoney(
            bestTradingWindow.revenue
          )}. `
        : ""
    }${
      topPayment ? `${topPayment.label} is the leading payment method. ` : ""
    }${topChannel ? `${topChannel.label} is the strongest sales channel.` : ""}`,
    highlights: [
      { label: "Paid Rate", value: formatPercent(data.overview.paidRate) },
      { label: "Pending", value: String(data.overview.pendingOrders) },
      { label: "Declined", value: String(data.overview.declinedOrders) },
      { label: "Avg Order", value: formatMoney(data.overview.averageOrderValue) },
    ],
    questionBack:
      "Do you want me to go deeper into conversion, the best cashier, or the strongest trading window?",
    comparisons: [
      buildCashExposureComparison(data),
      buildCashierComparison(data.topCashiers),
      buildPaymentComparison(data.paymentMethodBreakdown),
      buildChannelComparison(data.channelBreakdown),
    ].filter(Boolean),
    sources: ["orders", "sales", "payments"],
  });
}

function answerStaffQuestion(question, data) {
  const query = normalizeText(question);
  const inactiveCount = Math.max(0, data.allUsers.length - data.activeUsers.length);
  const trackedRevenue = Number(data.overview.paidRevenue || data.overview.totalRevenue || 0);
  const topCashierShare =
    data.topCashier && trackedRevenue
      ? (Number(data.topCashier.revenue || 0) / trackedRevenue) * 100
      : 0;
  const daypartRank = [...(data.daypartPerformance || [])].sort(
    (a, b) => Number(b.revenue || 0) - Number(a.revenue || 0)
  );
  const peakWindow = daypartRank[0] || null;
  const secondWindow = daypartRank[1] || null;
  const shiftSpecific =
    includesAny(query, ["shift", "window", "morning", "midday", "afternoon", "evening", "late"]) ||
    /coverage/.test(query);

  const checkoutNarrative =
    data.cashiers.length === 0
      ? "No active cashier role is visible, so checkout continuity is uncovered."
      : data.cashiers.length === 1
      ? `Only one active cashier is visible, so checkout continuity depends on ${
          data.topCashier?.cashier || "a single operator"
        }.`
      : topCashierShare >= 45 && data.topCashier
      ? `${data.topCashier.cashier} is carrying ${formatPercent(
          topCashierShare
        )} of tracked revenue, so the front desk is still too dependent on one cashier routine.`
      : `${data.cashiers.length} cashiers are active, so front-of-house coverage is not concentrated in one person.`;

  const inventoryNarrative =
    data.clerks.length === 0
      ? "No inventory clerk is active, so receiving and cycle counts do not have clear ownership."
      : data.clerks.length === 1
      ? "Inventory control depends on one clerk, so absences or receiving delays will hit stock accuracy quickly."
      : `${data.clerks.length} inventory clerks are active, so stock accountability is shared.`;

  const managementNarrative =
    data.managers.length === 0
      ? "No active manager is visible beyond owner control, so escalation coverage is thin."
      : data.managers.length === 1
      ? "Only one manager is active, so roster review and shift escalation depend on one person."
      : `${data.managers.length} managers support roster control and escalation coverage.`;

  const accessNarrative =
    inactiveCount > 0
      ? `${inactiveCount} inactive accounts still need cleanup so access stays disciplined.`
      : "Access hygiene is clean with no inactive-account backlog.";

  const statusTone =
    data.cashiers.length === 0 || data.clerks.length === 0
      ? "danger"
      : data.cashiers.length === 1 ||
        data.clerks.length === 1 ||
        data.managers.length <= 1 ||
        inactiveCount > 0 ||
        topCashierShare >= 45
      ? "warning"
      : "success";
  const shiftNarrative = peakWindow
    ? `${peakWindow.label} is carrying the heaviest trading load at ${formatMoney(
        peakWindow.revenue
      )} across ${peakWindow.orders} orders${
        secondWindow ? `, with ${secondWindow.label} next in line.` : ""
      } ${
        data.cashiers.length <= 1
          ? "That makes the busiest window effectively single-threaded at checkout."
          : "The current cashier depth is less fragile across the busiest window."
      }`
    : "Shift pressure will sharpen as more timestamped sales are recorded.";

  return buildAssistantPayload({
    statusTone,
    headline: "Staff coverage and control",
    answer: shiftSpecific
      ? `Shift coverage should be judged against live demand windows, not just headcount. ${shiftNarrative} ${checkoutNarrative} ${inventoryNarrative} ${managementNarrative} ${accessNarrative}`
      : `There are ${data.activeUsers.length} active staff accounts across the store. ${checkoutNarrative} ${inventoryNarrative} ${managementNarrative} ${accessNarrative} ${shiftNarrative}`,
    highlights: [
      { label: "Active Staff", value: String(data.activeUsers.length) },
      { label: "Cashiers", value: String(data.cashiers.length) },
      { label: "Inventory Clerks", value: String(data.clerks.length) },
      { label: "Inactive Accounts", value: String(inactiveCount) },
      {
        label: "Cashier Dependence",
        value: data.topCashier && trackedRevenue ? formatPercent(topCashierShare) : "No sales history",
      },
      {
        label: "Peak Window",
        value: peakWindow?.label || "No window yet",
      },
    ],
    questionBack:
      "Do you want me to focus next on shift pressure, access cleanup, or cashier dependency?",
    comparisons: [
      buildStaffCoverageComparison(data, inactiveCount),
      buildShiftCoverageComparison(data.daypartPerformance, data.cashiers.length, data.managers.length, data.clerks.length),
      buildCashierComparison(data.topCashiers),
    ].filter(Boolean),
    drilldowns: [
      buildDrilldown(
        "Audit staffing pressure",
        "Start with roster coverage, then verify who is carrying checkout performance, then confirm which trading window is under the most pressure.",
        ["usersDirectory", "ordersCashiers", "dashboardTradingWindow"]
      ),
    ].filter(Boolean),
    sources: ["staff", "orders"],
  });
}

function answerCustomersQuestion(question, data, history = []) {
  const query = normalizeText(question);
  const customerIntel = data.customersIntel || {};
  const matchedCustomer = findMentionedCustomer(question, { ...data, customersIntel: customerIntel }, history);
  const topCustomer = customerIntel.topCustomers?.[0] || customerIntel.customers?.[0] || null;
  const atRiskCustomers = Array.isArray(customerIntel.atRiskCustomers) ? customerIntel.atRiskCustomers : [];
  const growingCustomers = Array.isArray(customerIntel.growingCustomers) ? customerIntel.growingCustomers : [];
  const walkInRevenueShare = Number(customerIntel.summary?.walkInRevenueShare || 0);
  const repeatCustomerRate = Number(customerIntel.summary?.repeatCustomerRate || 0);

  if (matchedCustomer) {
    return buildAssistantPayload({
      statusTone: matchedCustomer.segment === "At Risk" || matchedCustomer.segment === "Dormant" ? "warning" : "success",
      headline: `${matchedCustomer.customer} relationship picture`,
      answer: `${matchedCustomer.customer} is currently in the ${String(matchedCustomer.segment || "tracked").toLowerCase()} segment with ${matchedCustomer.orders} paid orders worth ${formatMoney(
        matchedCustomer.paidRevenue
      )}. The last seen gap is ${matchedCustomer.daysSinceLastSeen} days and the lead channel is ${
        matchedCustomer.leadChannel || "not yet established"
      }. ${matchedCustomer.recommendedAction || "Use this account as part of the current customer watchlist."}`,
      highlights: [
        { label: "Segment", value: matchedCustomer.segment || "Tracked" },
        { label: "Revenue", value: formatMoney(matchedCustomer.paidRevenue || 0) },
        { label: "Orders", value: String(Number(matchedCustomer.orders || 0)) },
        { label: "Last Seen", value: `${Number(matchedCustomer.daysSinceLastSeen || 0)} days` },
      ],
      questionBack: `Do you want me to compare ${matchedCustomer.customer} against the strongest account or the customers currently cooling off?`,
      comparisons: [
        buildCustomerComparison(
          "Top Accounts",
          customerIntel.topCustomers || customerIntel.customers || [],
          5,
          "The named accounts currently carrying the most value."
        ),
        buildCustomerComparison(
          "Retention Watch",
          atRiskCustomers,
          5,
          "Named customers whose recency or repeat behavior is slipping."
        ),
      ].filter(Boolean),
      drilldowns: [
        buildDrilldown(
          "Inspect customer relationship health",
          "Open the customer directory, then review the retention watch, then compare named demand against walk-in dependence.",
          ["customersDirectory", "customersRetention", "customersMomentum"]
        ),
      ].filter(Boolean),
      sources: ["customers", "sales"],
    });
  }

  if (includesAny(query, ["cooling", "cooling off", "at risk", "retention", "churn"])) {
    return buildAssistantPayload({
      statusTone: atRiskCustomers.length ? "warning" : "success",
      headline: atRiskCustomers.length ? "Cooling customer watchlist" : "No customer is cooling off hard enough to flag",
      answer: atRiskCustomers.length
        ? `${atRiskCustomers[0].customer} is the lead cooling account with ${formatMoney(
            atRiskCustomers[0].paidRevenue
          )} in named revenue and ${atRiskCustomers[0].daysSinceLastSeen} days since the last visit. ${
            atRiskCustomers.length > 1
              ? `${atRiskCustomers.length} named customers are on the retention watchlist overall.`
              : "That account is the main retention watchpoint right now."
          }`
        : "No named customer is currently cooling off hard enough to flag. Retention is stable enough to focus on widening the repeat base rather than rescuing a slipping account.",
      highlights: [
        { label: "At-Risk Accounts", value: String(atRiskCustomers.length) },
        { label: "Cooling Revenue", value: formatMoney(customerIntel.summary?.coolingRevenue || 0) },
        { label: "Repeat Rate", value: formatPercent(repeatCustomerRate) },
        { label: "Walk-In Share", value: formatPercent(walkInRevenueShare) },
      ],
      questionBack: "Do you want the full retention watchlist, the strongest repeat accounts, or the full customer directory?",
      comparisons: [
        buildCustomerComparison(
          "Retention Watch",
          atRiskCustomers,
          5,
          "Named customers whose recency or repeat behavior is slipping."
        ),
        buildCustomerComparison(
          "Growth Accounts",
          growingCustomers,
          5,
          "Named customers currently carrying repeat or champion demand."
        ),
      ].filter(Boolean),
      drilldowns: [
        buildDrilldown(
          "Audit customer retention",
          "Start with the retention watch, then inspect the customer directory, then compare named demand against walk-in dependence.",
          ["customersRetention", "customersDirectory", "customersMomentum"]
        ),
      ].filter(Boolean),
      sources: ["customers", "sales"],
    });
  }

  if (includesAny(query, ["repeat", "returning", "coming back", "loyal", "loyalty"])) {
    return buildAssistantPayload({
      statusTone: repeatCustomerRate < 30 ? "warning" : "success",
      headline: "Repeat demand picture",
      answer: `${formatPercent(repeatCustomerRate)} of named customers have already returned at least twice, contributing ${formatMoney(
        customerIntel.summary?.repeatRevenue || 0
      )} in repeat revenue. ${
        growingCustomers[0]
          ? `${growingCustomers[0].customer} is the clearest repeat relationship to protect.`
          : "The repeat layer will strengthen as more named orders are captured."
      }`,
      highlights: [
        { label: "Repeat Rate", value: formatPercent(repeatCustomerRate) },
        { label: "Repeat Revenue", value: formatMoney(customerIntel.summary?.repeatRevenue || 0) },
        { label: "Champion Count", value: String(customerIntel.summary?.championCount || 0) },
        { label: "Repeat Count", value: String(customerIntel.summary?.repeatCount || 0) },
      ],
      questionBack: "Do you want the strongest repeat accounts, the cooling accounts, or the full directory?",
      comparisons: [
        buildCustomerComparison(
          "Top Accounts",
          customerIntel.topCustomers || customerIntel.customers || [],
          5,
          "The named accounts carrying the strongest demand."
        ),
        buildCustomerComparison(
          "Growth Accounts",
          growingCustomers,
          5,
          "Customers currently proving repeat or champion demand."
        ),
      ].filter(Boolean),
      sources: ["customers", "sales"],
    });
  }

  return buildAssistantPayload({
    statusTone: walkInRevenueShare >= 70 ? "warning" : "success",
    headline: "Customer demand quality",
    answer: `${customerIntel.executiveSummary?.summary || "Customer demand is live."} ${
      topCustomer
        ? `${topCustomer.customer} is the lead named account with ${formatMoney(topCustomer.paidRevenue)} across ${topCustomer.orders} paid orders.`
        : "No clear lead customer is visible yet."
    }`,
    highlights: [
      { label: "Named Revenue", value: formatMoney(customerIntel.summary?.namedRevenue || 0) },
      { label: "Repeat Revenue", value: formatMoney(customerIntel.summary?.repeatRevenue || 0) },
      { label: "Walk-In Share", value: formatPercent(walkInRevenueShare) },
      { label: "Lead Customer", value: customerIntel.summary?.topCustomer || "No clear leader yet" },
    ],
    questionBack: "Do you want named-account momentum, the retention watchlist, or the customer directory?",
    comparisons: [
      buildCustomerComparison(
        "Top Accounts",
        customerIntel.topCustomers || customerIntel.customers || [],
        5,
        "Named accounts currently carrying the strongest customer value."
      ),
      buildCustomerComparison(
        "Retention Watch",
        atRiskCustomers,
        5,
        "Named customers at risk of cooling off."
      ),
    ].filter(Boolean),
    drilldowns: [
      buildDrilldown(
        "Follow customer demand quality",
        "Start with customer momentum, then inspect the retention watchlist, then open the full customer directory for the exact accounts behind the pattern.",
        ["customersMomentum", "customersRetention", "customersDirectory"]
      ),
    ].filter(Boolean),
    sources: ["customers", "sales"],
  });
}

function answerPurchaseOrdersQuestion(question, data, history = []) {
  const topOpen = data.purchaseOrderSummary.topOpenSupplier;
  const matchedOrder = findMentionedPurchaseOrder(question, data, history);
  const matchedSupplier = findMentionedSupplier(question, data, history);

  if (matchedOrder) {
    return buildAssistantPayload({
      statusTone:
        String(matchedOrder.status) === "Received"
          ? "success"
          : String(matchedOrder.status) === "Sent"
          ? "warning"
          : "warning",
      headline: `${matchedOrder.id} purchase order`,
      answer: `${matchedOrder.id} is ${String(matchedOrder.status).toLowerCase()} with ${
        Array.isArray(matchedOrder.items) ? matchedOrder.items.length : 0
      } lines for ${formatMoney(matchedOrder.totalEstimatedCost)}. The supplier is ${
        matchedOrder.supplier || "not set"
      } and it was created on ${formatDate(matchedOrder.createdAt)}.`,
      highlights: [
        { label: "Status", value: String(matchedOrder.status) },
        { label: "Supplier", value: matchedOrder.supplier || "Unknown" },
        { label: "Lines", value: String(Array.isArray(matchedOrder.items) ? matchedOrder.items.length : 0) },
        { label: "Value", value: formatMoney(matchedOrder.totalEstimatedCost) },
      ],
      questionBack: `Do you want me to connect ${matchedOrder.id} to the products it is covering or to the supplier risk behind it?`,
      comparisons: [
        buildComparisonTable(
          `${matchedOrder.id} line items`,
          ["Item", "Units", "Estimated Cost"],
          Array.isArray(matchedOrder.items)
            ? matchedOrder.items.slice(0, 6).map((item) => {
                const units = Number(
                  item.quantity ?? item.qty ?? item.unitsRequested ?? item.units ?? 0
                );
                const unitCost = Number(item.unitCost ?? item.cost ?? item.price ?? 0);
                const lineCost =
                  Number(item.estimatedCost ?? item.totalCost ?? item.lineTotal ?? units * unitCost) || 0;

                return [
                  item.productName || item.name || item.sku || "Unknown Item",
                  String(units),
                  formatMoney(lineCost),
                ];
              })
            : [],
          "The leading lines inside this purchase order."
        ),
      ].filter(Boolean),
      sources: ["purchase orders", "inventory"],
    });
  }

  if (matchedSupplier?.supplier) {
    const supplierRisk = getSupplierRiskDetails(matchedSupplier.supplier, data);

    return buildAssistantPayload({
      statusTone: supplierRisk.statusTone,
      headline: `${matchedSupplier.supplier} purchase order position`,
      answer: `${supplierRisk.answer} ${matchedSupplier.supplier} has ${
        supplierRisk.supplierOrders.length
      } purchase orders on record overall, with ${supplierRisk.openOrders.length} still open for ${formatMoney(
        supplierRisk.openOrderValue
      )}.`,
      highlights: [
        { label: "Orders", value: String(supplierRisk.supplierOrders.length) },
        { label: "Open", value: String(supplierRisk.openOrders.length) },
        {
          label: "Avg Lead Time",
          value:
            supplierRisk.serviceMetrics.averageLeadTimeDays === null
              ? "No received history"
              : `${supplierRisk.serviceMetrics.averageLeadTimeDays.toFixed(1)} days`,
        },
        {
          label: "Fill Rate",
          value:
            supplierRisk.serviceMetrics.fillRate === null
              ? "No ordered units"
              : formatPercent(supplierRisk.serviceMetrics.fillRate),
        },
      ],
      questionBack: `Do you want me to list the specific SKUs that depend on ${matchedSupplier.supplier} or the purchase orders that should protect them?`,
      actions: buildNavigationActions([
        "suppliersCommitments",
        "suppliersRiskLadder",
        "inventoryReorderPlanner",
      ]),
      comparisons: [
        buildPurchaseOrderComparison(supplierRisk.supplierOrders),
        buildSupplierServiceComparison(matchedSupplier.supplier, supplierRisk.supplierOrders),
        buildComparisonTable(
          `${matchedSupplier.supplier} SKU exposure`,
          ["SKU", "Stock", "Cover", "Urgency"],
          supplierRisk.pressuredSkus.slice(0, 5).map((item) => [
            item.name,
            String(Number(item.stock || 0)),
            formatDaysCover(item.estimatedDaysCover),
            item.status || "Watch",
          ]),
          "Products currently depending on this supplier."
        ),
      ].filter(Boolean),
      drilldowns: [
        buildDrilldown(
          "Follow supplier execution",
          "Open the supplier commitments table, then inspect the supplier risk ladder, then confirm which SKUs still depend on that inbound cover.",
          ["suppliersCommitments", "suppliersRiskLadder", "inventoryReorderPlanner"]
        ),
      ].filter(Boolean),
      sources: ["purchase orders", "inventory"],
    });
  }

  return buildAssistantPayload({
    statusTone: data.purchaseOrderSummary.sentCount > 0 || data.purchaseOrderSummary.draftCount > 0 ? "warning" : "success",
    headline: "Purchase order position",
    answer: `There are ${data.purchaseOrderSummary.total} purchase orders in the system: ${
      data.purchaseOrderSummary.draftCount
    } draft, ${data.purchaseOrderSummary.sentCount} sent, and ${
      data.purchaseOrderSummary.receivedCount
    } received. ${
      topOpen
        ? `${topOpen.supplier} has the largest open order at ${formatMoney(topOpen.totalEstimatedCost)}.`
        : "There is no major open supplier exposure right now."
    }`,
    highlights: [
      { label: "Draft", value: String(data.purchaseOrderSummary.draftCount) },
      { label: "Sent", value: String(data.purchaseOrderSummary.sentCount) },
      { label: "Received", value: String(data.purchaseOrderSummary.receivedCount) },
      { label: "Largest Open", value: topOpen ? topOpen.supplier : "None" },
    ],
    questionBack:
      "Do you want me to connect open purchase orders to supplier risk or to the products that need reordering most?",
    comparisons: [
      buildPurchaseOrderComparison(data.purchaseOrders),
      buildSupplierPressureComparison(data.inventoryIntel.supplierWatch),
    ].filter(Boolean),
    sources: ["purchase orders", "inventory"],
  });
}

function answerCycleCountsQuestion(question, data, history = []) {
  const latestCompleted = data.cycleCountSummary.latestCompleted;
  const matchedCount = findMentionedCycleCount(question, data, history);

  if (matchedCount) {
    return buildAssistantPayload({
      statusTone: String(matchedCount.status) === "Completed" ? "success" : "warning",
      headline: `${matchedCount.id} cycle count`,
      answer: `${matchedCount.id} is ${String(matchedCount.status).toLowerCase()} with ${
        Array.isArray(matchedCount.items) ? matchedCount.items.length : 0
      } lines. It was created on ${formatDate(matchedCount.createdAt)}${
        matchedCount.completedAt ? ` and completed on ${formatDate(matchedCount.completedAt)}.` : "."
      }`,
      highlights: [
        { label: "Status", value: String(matchedCount.status) },
        { label: "Lines", value: String(Array.isArray(matchedCount.items) ? matchedCount.items.length : 0) },
        { label: "Created", value: formatDate(matchedCount.createdAt) },
        { label: "Completed", value: matchedCount.completedAt ? formatDate(matchedCount.completedAt) : "Open" },
      ],
      questionBack: `Do you want me to connect ${matchedCount.id} to stock accuracy risk or to the products inside that count?`,
      sources: ["cycle counts", "inventory"],
    });
  }

  return buildAssistantPayload({
    statusTone: data.cycleCountSummary.openCount > 0 ? "warning" : "success",
    headline: "Cycle count coverage",
    answer: `There are ${data.cycleCountSummary.total} cycle counts on record, with ${
      data.cycleCountSummary.openCount
    } still open and ${data.cycleCountSummary.completedCount} completed. ${
      latestCompleted
        ? `The latest completed count was ${latestCompleted.id} on ${formatDate(
            latestCompleted.completedAt || latestCompleted.createdAt
          )}.`
        : "No completed count has been recorded yet."
    }`,
    highlights: [
      { label: "Open Counts", value: String(data.cycleCountSummary.openCount) },
      { label: "Completed", value: String(data.cycleCountSummary.completedCount) },
      { label: "Latest Count", value: latestCompleted ? latestCompleted.id : "None" },
    ],
    questionBack:
      "Do you want me to connect cycle counts to inventory risk or to the products where stock accuracy matters most?",
    sources: ["cycle counts", "inventory"],
  });
}

function answerConversationQuestion(question) {
  const direct = normalizeText(question);

  if (isThanks(direct)) {
    return buildAssistantPayload({
      headline: "Ready for the next question",
      answer:
        "Ask about revenue, inventory, orders, suppliers, staffing, purchase orders, or overall business health and I will answer from the live workspace data.",
      questionBack: "What do you want to check next?",
      sources: [],
    });
  }

  if (isCapabilityQuestion(direct)) {
    return buildAssistantPayload({
      headline: "What I can answer",
      answer:
        "I can answer grounded questions about revenue, profit, growth, products, stock risk, suppliers, purchase orders, cycle counts, cashier performance, staff coverage, and overall business health.",
      questionBack:
        "Do you want to start with revenue, inventory, orders, supplier risk, staffing, or a full business summary?",
      sources: ["sales", "inventory", "staff", "purchase orders", "reports"],
    });
  }

  return buildAssistantPayload({
    headline: "Ask about the business",
    answer:
      "Ask a business question in plain language and I will answer from live workspace data. You can mention a product, supplier, cashier, purchase order, cycle count, or ask for an overall summary.",
    questionBack:
      "For example, do you want to check what needs attention today, which products to reorder, or how revenue is performing?",
    sources: ["sales", "inventory", "staff", "purchase orders", "reports"],
  });
}

function answerClarificationQuestion() {
  return buildAssistantPayload({
    statusTone: "warning",
    headline: "I could not map that request",
    answer:
      "I could not connect that message to live sales, inventory, orders, suppliers, staffing, or reporting data. Ask a clear business question or mention a specific product, supplier, cashier, purchase order, or cycle count.",
    questionBack:
      "Do you want revenue, inventory, orders, supplier risk, staffing, or an overall business summary?",
    sources: [],
  });
}

function answerGeneralQuestion(data) {
  return buildAssistantPayload({
    statusTone:
      data.inventorySignals.lowStockCount > 0 || data.overview.pendingOrders > 0 ? "warning" : "success",
    headline: "Current business picture",
    answer: `Revenue stands at ${formatMoney(data.overview.totalRevenue)} with ${formatPercent(
      data.overview.paidRate
    )} paid conversion. ${
      data.topRisk
        ? `${data.topRisk.name} is the lead inventory risk at ${Number(data.topRisk.stock || 0)} units. `
        : ""
    }${
      data.reports.summary.topCategory
        ? `${data.reports.summary.topCategory} is the strongest category right now. `
        : ""
    }${
      data.purchaseOrderSummary.sentCount > 0 || data.purchaseOrderSummary.draftCount > 0
        ? `${data.purchaseOrderSummary.sentCount + data.purchaseOrderSummary.draftCount} purchase orders are still open.`
        : "Purchase order pressure is currently light."
    }`,
    highlights: [
      { label: "Revenue", value: formatMoney(data.overview.totalRevenue) },
      { label: "Paid Rate", value: formatPercent(data.overview.paidRate) },
      { label: "Low Stock", value: String(data.inventorySignals.lowStockCount) },
      { label: "Top Category", value: data.reports.summary.topCategory || "No leader yet" },
    ],
    questionBack:
      "Do you want me to break that down by revenue, inventory, orders, staff, or supplier risk?",
    comparisons: [
      buildReorderComparison(data.inventoryIntel.reorderNow),
      buildProductComparison(data.productInsights),
      buildPurchaseOrderComparison(data.purchaseOrders),
    ].filter(Boolean),
    sources: ["sales", "inventory", "staff", "purchase orders", "reports"],
  });
}

async function getOwnerAssistantBootstrap() {
  const data = await getBaseDataset();
  const summary = answerGeneralQuestion(data);

  return {
    ...withNavigationActions(summary, "general", ""),
    intelligence: buildAiSignalBundle(data),
    greeting:
      "Ask anything about the business in plain language. I use live workspace data for revenue, stock, supplier, staffing, forecast, and anomaly questions, and I can keep the conversation going with follow-up context.",
    followUps: [
      "What does the demand forecast say for next week?",
      "Which products are at stockout risk?",
      "How reliable is the model?",
      "Any unusual patterns I should know about?",
    ],
  };
}

function buildAskBusinessQuestionPayload() {
  return buildAssistantPayload({
    statusTone: "warning",
    headline: "Ask a business question",
    answer:
      "Ask anything about the business in plain language. I can answer from live sales, inventory, staffing, purchase-order, and reporting data.",
    questionBack:
      "Do you want to start with revenue, inventory, orders, supplier risk, staffing, or overall business health?",
    sources: ["sales", "inventory", "staff", "reports"],
  });
}

function getGroundedOwnerAssistantReply(question, history = [], data) {
  const direct = normalizeText(question);

  if (!direct) {
    return withNavigationActions(buildAskBusinessQuestionPayload(), "general", question);
  }

  if (isGreeting(direct) || isThanks(direct) || isCapabilityQuestion(direct)) {
    return withNavigationActions(answerConversationQuestion(question), "general", question);
  }

  const shortFollowUp = resolveShortFollowUp(question, history);
  if (shortFollowUp?.kind === "question") {
    return getGroundedOwnerAssistantReply(shortFollowUp.question, history, data);
  }
  if (shortFollowUp?.kind === "reply") {
    return withNavigationActions(shortFollowUp.reply, inferAssistantScope(question, data, history), question);
  }

  const aiSignalAnswer = answerAiSignalsQuestion(question, data);
  if (aiSignalAnswer) {
    return withNavigationActions(aiSignalAnswer, inferAssistantScope(question, data, history), question);
  }

  if (shouldClarifyQuestion(question, data, history)) {
    return withNavigationActions(answerClarificationQuestion(), "general", question);
  }

  const timeScopedAnswer = answerTimeScopedQuestion(question, data, history);
  if (timeScopedAnswer) {
    return withNavigationActions(
      timeScopedAnswer,
      inferAssistantScope(question, data, history),
      question
    );
  }

  const decisionAnswer = answerDecisionQuestion(question, data, history);
  if (decisionAnswer) {
    return withNavigationActions(
      decisionAnswer,
      inferAssistantScope(question, data, history),
      question
    );
  }

  const scope = inferAssistantScope(question, data, history);

  switch (scope) {
    case "purchase-orders":
      return withNavigationActions(answerPurchaseOrdersQuestion(question, data, history), scope, question);
    case "cycle-counts":
      return withNavigationActions(answerCycleCountsQuestion(question, data, history), scope, question);
    case "suppliers":
      return withNavigationActions(answerSuppliersQuestion(question, data, history), scope, question);
    case "inventory":
      return withNavigationActions(answerInventoryQuestion(question, data, history), scope, question);
    case "orders":
      return withNavigationActions(answerOrdersQuestion(question, data, history), scope, question);
    case "customers":
      return withNavigationActions(answerCustomersQuestion(question, data, history), scope, question);
    case "staff":
      return withNavigationActions(answerStaffQuestion(question, data), scope, question);
    case "revenue":
      return withNavigationActions(answerRevenueQuestion(question, data, history), scope, question);
    case "general":
    default:
      return withNavigationActions(answerGeneralQuestion(data), scope, question);
  }
}

function buildOwnerAssistantContext(data) {
  const aiSignals = buildAiSignalBundle(data);
  const supplierSignals = (data.inventoryIntel.supplierWatch || []).slice(0, 4).map((item) => {
    const metrics = getSupplierServiceMetrics(
      data.purchaseOrders.filter(
        (order) => normalizeText(order.supplier) === normalizeText(item.supplier)
      )
    );

    return {
      supplier: item.supplier,
      atRiskSkus: Number(item.atRiskProducts || 0),
      urgencyScore: Number(item.urgencyScore || 0).toFixed(1),
      averageLeadTimeDays:
        metrics.averageLeadTimeDays === null ? null : Number(metrics.averageLeadTimeDays.toFixed(1)),
      fillRate: metrics.fillRate === null ? null : Number(metrics.fillRate.toFixed(1)),
      leadSku: item.topExposure
        ? {
            name: item.topExposure.name,
            stock: Number(item.topExposure.stock || 0),
            estimatedDaysCover:
              item.topExposure.estimatedDaysCover === null ||
              item.topExposure.estimatedDaysCover === undefined
                ? null
                : Number(item.topExposure.estimatedDaysCover),
          }
        : null,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    availableSources: ["sales", "inventory", "reports", "customers", "suppliers", "staff", "purchase orders", "cycle counts", "forecasting"],
    storeSnapshot: {
      recognizedRevenue: Number(data.overview.totalRevenue || 0),
      paidOrders: Number(data.overview.paidOrders || 0),
      totalOrders: Number(data.overview.totalOrders || 0),
      paidRate: Number(data.overview.paidRate || 0),
      averageOrderValue: Number(data.overview.averageOrderValue || 0),
      pendingRevenue: Number(data.overview.pendingRevenue || 0),
      declinedRevenue: Number(data.overview.declinedRevenue || 0),
      profit: Number(data.reports.summary?.profit || 0),
      profitCoverageRate: Number(data.reports.summary?.profitCoverageRate || 0),
      uncostedRevenue: Number(data.reports.summary?.uncostedRevenue || 0),
      inventoryValue: Number(data.overview.totalInventoryValue || 0),
    },
    dailyBriefing: aiSignals.dailyBriefing
      ? {
          statusTone: aiSignals.dailyBriefing.statusTone,
          headline: aiSignals.dailyBriefing.headline,
          summary: aiSignals.dailyBriefing.summary,
          nextMove: aiSignals.dailyBriefing.nextMove,
        }
      : null,
    restockSuggestions: aiSignals.restockSuggestions,
    riskAlerts: (aiSignals.riskAlerts || []).slice(0, 5).map((item) => ({
      label: item.label,
      value: item.value,
      note: item.note,
      tone: item.tone,
    })),
    salesInsights: (aiSignals.salesInsights || []).slice(0, 5).map((item) => ({
      title: item.title,
      message: item.message,
      type: item.type,
    })),
    machineLearning: data.machineForecast
      ? {
          modelFamily: data.machineForecast.modelFamily,
          engine: data.machineForecast.engine || null,
          planningDays: Number(data.machineForecast.overview?.planningDays || 0),
          confidenceScore: Number(data.machineForecast.overview?.confidenceScore || 0),
          revenueWape: Number(data.machineForecast.overview?.revenueWape || 0),
          ordersWape: Number(data.machineForecast.overview?.ordersWape || 0),
          predictionInterval: data.machineForecast.overview?.predictionInterval || null,
          nextProjection: data.machineForecast.periods?.[0]
            ? {
                label: data.machineForecast.periods[0].label,
                projectedRevenue: Number(data.machineForecast.periods[0].projectedRevenue || 0),
                projectedOrders: Number(data.machineForecast.periods[0].projectedOrders || 0),
                projectedRevenueLower: Number(
                  data.machineForecast.periods[0].projectedRevenueLower || 0
                ),
                projectedRevenueUpper: Number(
                  data.machineForecast.periods[0].projectedRevenueUpper || 0
                ),
              }
            : null,
          topReorderCandidates: (data.machineForecast.restockRecommendations || [])
            .slice(0, 4)
            .map((item) => ({
              name: item.name,
              sku: item.sku,
              supplier: item.supplier,
              riskLevel: item.riskLevel,
              stockPolicyClass: item.stockPolicyClass || "standard",
              serviceLevelTargetPct: Number(item.serviceLevelTargetPct || 0),
              recommendedOrderQty: Number(item.recommendedOrderQty || 0),
              orderSpend: Number(item.orderSpend || 0),
              forecastUnits: Number(item.forecastUnits || 0),
              confidenceScore: Number(item.confidenceScore || 0),
              stockoutProbability: Number(item.stockoutProbability || 0),
              cashPriorityScore: Number(item.cashPriorityScore || 0),
              cashPriorityTier: item.cashPriorityTier || "",
              leadTimeP90Days: Number(item.leadTimeP90Days || item.leadTimeDays || 0),
              topDrivers: Array.isArray(item.topDrivers) ? item.topDrivers.slice(0, 3) : [],
              nextAction: item.nextAction || "",
              cashPriorityReason: item.cashPriorityReason || "",
              whyNow: item.whyNow || "",
            })),
          anomalyAlerts: (data.machineForecast.anomalyAlerts || []).slice(0, 4).map((item) => ({
            metric: item.metric,
            headline: item.headline,
            tone: item.tone,
            deviationPercent: Number(item.deviationPercent || 0),
            zScore: Number(item.zScore || 0),
            date: item.date,
          })),
          stockoutRisks: (data.machineForecast.stockoutRisks || []).slice(0, 4).map((item) => ({
            name: item.name,
            sku: item.sku,
            supplier: item.supplier,
            riskLevel: item.riskLevel,
            stockPolicyClass: item.stockPolicyClass || "standard",
            serviceLevelTargetPct: Number(item.serviceLevelTargetPct || 0),
            projectedStockoutDays:
              item.projectedStockoutDays === null || item.projectedStockoutDays === undefined
                ? null
                : Number(item.projectedStockoutDays),
            recommendedOrderQty: Number(item.recommendedOrderQty || 0),
            orderSpend: Number(item.orderSpend || 0),
            cashPriorityScore: Number(item.cashPriorityScore || 0),
            cashPriorityTier: item.cashPriorityTier || "",
            topDrivers: Array.isArray(item.topDrivers) ? item.topDrivers.slice(0, 3) : [],
            nextAction: item.nextAction || "",
            cashPriorityReason: item.cashPriorityReason || "",
          })),
          promotionCandidates: (data.machineForecast.promotionCandidates || []).slice(0, 4).map((item) => ({
            name: item.name,
            sku: item.sku,
            trendDirection: item.trendDirection,
            confidenceScore: Number(item.confidenceScore || 0),
            grossMarginPct: Number(item.grossMarginPct || 0),
            stockBuffer: Number(item.stockBuffer || 0),
            nextAction: item.nextAction || "",
          })),
          supplierSignals: (data.machineForecast.supplierSignals || []).slice(0, 4).map((item) => ({
            supplier: item.supplier,
            weightedRiskScore: Number(item.weightedRiskScore || 0),
            serviceScore: Number(item.serviceScore || 0),
            delayRiskScore: Number(item.delayRiskScore || 0),
            openOrders: Number(item.openOrders || 0),
            lateOpenOrders: Number(item.lateOpenOrders || 0),
            maxStockoutProbability: Number(item.maxStockoutProbability || 0),
            topDrivers: Array.isArray(item.topDrivers) ? item.topDrivers.slice(0, 3) : [],
            nextAction: item.nextAction || "",
          })),
          portfolioSummary: data.machineForecast.portfolioSummary
            ? {
                exposedRevenue: Number(data.machineForecast.portfolioSummary.exposedRevenue || 0),
                recommendedOrderUnits: Number(
                  data.machineForecast.portfolioSummary.recommendedOrderUnits || 0
                ),
                recommendedOrderSpend: Number(
                  data.machineForecast.portfolioSummary.recommendedOrderSpend || 0
                ),
                highPriorityOrderSpend: Number(
                  data.machineForecast.portfolioSummary.highPriorityOrderSpend || 0
                ),
                protectedRevenue: Number(
                  data.machineForecast.portfolioSummary.protectedRevenue || 0
                ),
                deferredSkuCount: Number(
                  data.machineForecast.portfolioSummary.deferredSkuCount || 0
                ),
                promotionRevenuePool: Number(
                  data.machineForecast.portfolioSummary.promotionRevenuePool || 0
                ),
                promotionMarginPool: Number(
                  data.machineForecast.portfolioSummary.promotionMarginPool || 0
                ),
                supplierPressureCount: Number(
                  data.machineForecast.portfolioSummary.supplierPressureCount || 0
                ),
              }
            : null,
          dataFoundation: data.machineForecast.dataFoundation
            ? {
                richnessScore: Number(data.machineForecast.dataFoundation.richnessScore || 0),
                historyDays: Number(data.machineForecast.dataFoundation.historyDays || 0),
                entityCounts: data.machineForecast.dataFoundation.entityCounts || {},
                coverage: data.machineForecast.dataFoundation.coverage || {},
                narrative: data.machineForecast.dataFoundation.narrative || "",
                qualityWarnings: Array.isArray(data.machineForecast.dataFoundation.qualityWarnings)
                  ? data.machineForecast.dataFoundation.qualityWarnings.slice(0, 4)
                  : [],
              }
            : null,
        }
      : null,
    demandDrivers: {
      topCategory: data.topCategory
        ? {
            name: data.topCategory.name,
            revenue: Number(data.topCategory.value || 0),
          }
        : null,
      topProduct: data.topProduct
        ? {
            name: data.topProduct.name,
            revenue: Number(data.topProduct.value || 0),
            units: Number(data.topProduct.units || 0),
          }
        : null,
      topPaymentMethod: data.paymentMethodBreakdown[0]
        ? {
            label: data.paymentMethodBreakdown[0].label,
            orders: Number(data.paymentMethodBreakdown[0].value || 0),
            revenue: Number(data.paymentMethodBreakdown[0].revenue || 0),
          }
        : null,
      topChannel: data.channelBreakdown[0]
        ? {
            label: data.channelBreakdown[0].label,
            orders: Number(data.channelBreakdown[0].value || 0),
            revenue: Number(data.channelBreakdown[0].revenue || 0),
          }
        : null,
      strongestTradingWindows: (data.daypartPerformance || []).slice(0, 4).map((item) => ({
        label: item.label,
        revenue: Number(item.revenue || 0),
        orders: Number(item.orders || 0),
        averageOrderValue: Number(item.averageOrderValue || 0),
      })),
    },
    inventory: {
      healthScore: Number(data.healthScore || 0),
      lowStockCount: Number(data.inventorySignals.lowStockCount || 0),
      outOfStockCount: Number(data.inventorySignals.outOfStockCount || 0),
      reorderNowCount: Number(data.inventoryIntel.summary?.reorderNowCount || 0),
      dormantStockCount: Number(data.inventoryIntel.summary?.dormantStockCount || 0),
      topRisk: data.topRisk
        ? {
            name: data.topRisk.name,
            supplier: data.topRisk.supplier,
            stock: Number(data.topRisk.stock || 0),
            estimatedDaysCover:
              data.topRisk.estimatedDaysCover === null || data.topRisk.estimatedDaysCover === undefined
                ? null
                : Number(data.topRisk.estimatedDaysCover),
            status: data.topRisk.status,
            recentRevenue: Number(data.topRisk.recentRevenue || data.topRisk.revenue || 0),
          }
        : null,
      supplierWatch: supplierSignals,
    },
    customers: {
      totalTracked: Number(data.customersIntel.summary?.totalCustomers || 0),
      namedRevenue: Number(data.customersIntel.summary?.namedRevenue || 0),
      namedRevenueShare: Number(data.customersIntel.summary?.namedRevenueShare || 0),
      repeatCustomerRate: Number(data.customersIntel.summary?.repeatCustomerRate || 0),
      topAccounts: (data.customersIntel.topCustomers || []).slice(0, 3).map((item, index) => ({
        label: `Account ${index + 1}`,
        segment: item.segment,
        revenue: Number(item.paidRevenue || 0),
        orders: Number(item.orders || 0),
        daysSinceLastSeen: Number(item.daysSinceLastSeen || 0),
      })),
    },
    staffing: {
      activeStaff: Number(data.activeUsers.length || 0),
      managers: Number(data.managers.length || 0),
      cashiers: Number(data.cashiers.length || 0),
      inventoryClerks: Number(data.clerks.length || 0),
      readinessScore: Number(data.dashboardDecisionModel?.staffingIntelligence?.readinessScore || 0),
      pendingApprovals: Number(data.dashboardDecisionModel?.staffingIntelligence?.pendingApprovals || 0),
      cashierDependence: Number(data.dashboardDecisionModel?.staffingIntelligence?.cashierDependence || 0),
    },
    operations: {
      purchaseOrders: {
        total: Number(data.purchaseOrderSummary.total || 0),
        draft: Number(data.purchaseOrderSummary.draftCount || 0),
        sent: Number(data.purchaseOrderSummary.sentCount || 0),
        received: Number(data.purchaseOrderSummary.receivedCount || 0),
        largestOpenCommitments: data.purchaseOrders
          .filter((order) => ["Draft", "Sent"].includes(String(order.status)))
          .slice(0, 4)
          .map((order) => ({
            id: order.id,
            supplier: order.supplier,
            status: order.status,
            value: Number(order.totalEstimatedCost || 0),
            openUnits: Number(order.openUnits || 0),
          })),
      },
      cycleCounts: {
        total: Number(data.cycleCountSummary.total || 0),
        open: Number(data.cycleCountSummary.openCount || 0),
        completed: Number(data.cycleCountSummary.completedCount || 0),
      },
      recentInventoryMovements: (data.recentMovements || []).slice(0, 4).map((movement) => ({
        productName: movement.productName,
        movementType: movement.movementType,
        quantityDelta: Number(movement.quantityDelta || 0),
        createdAt: movement.createdAt,
      })),
    },
  };
}

function getStatusTonePriority(statusTone = "neutral") {
  const priorities = {
    neutral: 0,
    success: 1,
    warning: 2,
    danger: 3,
  };

  return priorities[statusTone] ?? 0;
}

function mergeAssistantReply(groundedReply, externalReply) {
  return buildAssistantPayload({
    statusTone:
      getStatusTonePriority(externalReply.statusTone) >=
      getStatusTonePriority(groundedReply.statusTone)
        ? externalReply.statusTone
        : groundedReply.statusTone,
    headline: externalReply.headline || groundedReply.headline,
    answer: externalReply.answer || groundedReply.answer,
    highlights:
      Array.isArray(externalReply.highlights) && externalReply.highlights.length > 0
        ? externalReply.highlights
        : groundedReply.highlights,
    comparisons: groundedReply.comparisons,
    actions: groundedReply.actions,
    drilldowns: groundedReply.drilldowns,
    sources: Array.from(
      new Set([...(externalReply.sources || []), ...(groundedReply.sources || [])])
    ).slice(0, 8),
    questionBack: externalReply.questionBack || groundedReply.questionBack,
    followUps: groundedReply.followUps,
  });
}

async function getOperationalAiSignals() {
  return buildAiSignalBundle(await getBaseDataset());
}

async function getOwnerAssistantReply(question, history = []) {
  const data = await getBaseDataset();
  const direct = normalizeText(question);
  const conversational = !direct || isGreeting(direct) || isThanks(direct) || isCapabilityQuestion(direct);
  const needsClarification = direct ? shouldClarifyQuestion(question, data, history) : false;
  const groundedReply = getGroundedOwnerAssistantReply(question, history, data);

  if (conversational || needsClarification || !runtime.externalAssistantEnabled) {
    return groundedReply;
  }

  try {
    const externalReply = await externalAiService.generateOwnerAssistantReply({
      question,
      history,
      businessSnapshot: buildOwnerAssistantContext(data),
      groundedReply,
    });

    if (!externalReply) {
      return groundedReply;
    }

    return mergeAssistantReply(groundedReply, externalReply);
  } catch (error) {
    console.error("getOwnerAssistantReply external provider error:", error.message || error);
    return groundedReply;
  }
}

module.exports = {
  getOwnerAssistantBootstrap,
  getOwnerAssistantReply,
  getOperationalAiSignals,
};
