function toNumber(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeReportPayload(payload) {
  if (payload?.summary || payload?.executiveSummary) return payload;
  if (payload?.data?.summary || payload?.data?.executiveSummary) return payload.data;
  return null;
}

export function normalizeApiArrayPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.data)) return payload.data.data;
  return [];
}

function safeDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function monthShort(index) {
  return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][index];
}

function weekdayShort(index) {
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][index];
}

function getRangeBucket(date, range = "monthly") {
  if (range === "daily") {
    return {
      key: `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`,
      label: weekdayShort(date.getDay()),
      sortValue: new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime(),
    };
  }

  if (range === "yearly") {
    const key = String(date.getFullYear());
    return {
      key,
      label: key,
      sortValue: Number(key),
    };
  }

  return {
    key: `${date.getFullYear()}-${date.getMonth()}`,
    label: monthShort(date.getMonth()),
    sortValue: new Date(date.getFullYear(), date.getMonth(), 1).getTime(),
  };
}

function getRangeLimit(range = "monthly") {
  if (range === "daily") return 7;
  if (range === "yearly") return 6;
  return 12;
}

function normalizeStatus(status) {
  const value = String(status || "Pending").trim().toLowerCase();
  if (["paid", "completed", "success"].includes(value)) return "Paid";
  if (["declined", "failed", "cancelled", "canceled", "refunded", "refund"].includes(value)) {
    return "Declined";
  }
  return "Pending";
}

function normalizeChannel(channel) {
  const value = String(channel || "In-Store").trim().toLowerCase();
  if (["online", "website", "web", "app"].includes(value)) return "Online";
  if (["delivery"].includes(value)) return "Delivery";
  if (["pickup", "pick-up"].includes(value)) return "Pickup";
  return "In-Store";
}

function getDaysBetween(laterDate, earlierDate) {
  const later = safeDate(laterDate);
  const earlier = safeDate(earlierDate);
  if (!later || !earlier) return null;
  return Math.max(0, Math.round((later.getTime() - earlier.getTime()) / 86400000));
}

function isNamedCustomer(customer) {
  const name = String(customer || "").trim();
  if (!name) return false;
  return !["Walk-in Customer", "Online Order", "Walk-In Customer"].includes(name);
}

function normalizeSales(sales = []) {
  return (Array.isArray(sales) ? sales : [])
    .map((sale) => ({
      ...sale,
      total: toNumber(sale.total),
      cashier: String(sale.cashier || "Front Desk").trim() || "Front Desk",
      customer: String(sale.customer || "Walk-in Customer").trim() || "Walk-in Customer",
      status: normalizeStatus(sale.status),
      channel: normalizeChannel(sale.channel),
      paymentMethod: String(sale.paymentMethod || "Card").trim() || "Card",
      items: Array.isArray(sale.items) ? sale.items : [],
      dateObj: safeDate(sale.date),
    }))
    .filter((sale) => sale.dateObj);
}

function buildCustomersExecutive({
  customers,
  repeatCustomers,
  repeatRevenue,
  walkInRevenueShare,
  topCustomer,
  topCustomerShare,
}) {
  let statusTone = "success";
  let headline = "Customer demand is visible and becoming usable.";
  let summary = `${customers.length} named customers are now visible and repeat demand is worth ${repeatRevenue.toFixed(
    2
  )}.`;
  let whyItMatters =
    "Named customers turn sales history into something the owner can act on, not just watch.";
  let nextMove = topCustomer
    ? `Protect ${topCustomer.customer}, then build repeat demand around similar buyers.`
    : "Start capturing more customer names at checkout so repeat demand can be tracked cleanly.";

  if (!customers.length) {
    statusTone = "warning";
    headline = "Customer intelligence is still mostly anonymous.";
    summary =
      "Named customers are not yet visible in the current live dataset, so retention and repeat-demand decisions stay weak.";
    whyItMatters =
      "Without named customer history, the business can only see transactions, not customer behavior.";
    nextMove = "Capture more names at checkout and convert frequent buyers into known accounts.";
  } else if (walkInRevenueShare >= 70) {
    statusTone = "warning";
    headline = "Too much paid revenue is still anonymous.";
    summary = `${walkInRevenueShare.toFixed(1)}% of paid revenue is still coming from walk-ins instead of known customers.`;
    whyItMatters =
      "That makes demand harder to defend because the business is still depending on anonymous traffic.";
    nextMove = "Tag more orders with customer identity and build follow-up around the strongest named accounts.";
  } else if ((customers.length ? (repeatCustomers.length / customers.length) * 100 : 0) < 30) {
    statusTone = "warning";
    headline = "Named customers exist, but repeat depth is still shallow.";
    summary = `${repeatCustomers.length} of ${customers.length} named customers have returned at least twice.`;
    whyItMatters =
      "One-off named purchases are not enough. Real customer strength comes from repeated baskets.";
    nextMove = "Focus on retention around the best-performing named accounts and categories.";
  } else if (topCustomerShare >= 38) {
    statusTone = "warning";
    headline = "Customer concentration is becoming a watchpoint.";
    summary = `${topCustomer?.customer || "One account"} is carrying ${topCustomerShare.toFixed(
      1
    )}% of named customer revenue.`;
    whyItMatters =
      "Strong lead customers help, but too much dependence on one account makes demand fragile.";
    nextMove = "Protect the lead account, then widen demand across the next tier of customers.";
  }

  return { statusTone, headline, summary, whyItMatters, nextMove };
}

export function buildCustomersFallbackDataset({
  sales = [],
  products = [],
  range = "monthly",
  currency = "CAD",
}) {
  const normalizedSales = normalizeSales(sales);
  const formatMoneyValue = (value) =>
    `${String(currency || "CAD").toUpperCase()} ${toNumber(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  const productMap = (Array.isArray(products) ? products : []).reduce((accumulator, product) => {
    accumulator[Number(product.id)] = product;
    return accumulator;
  }, {});

  const latestObservedAt =
    normalizedSales.reduce(
      (latest, sale) => (!latest || sale.dateObj > latest ? sale.dateObj : latest),
      null
    ) || new Date();
  const customerMap = {};
  const trendGrouped = {};
  let paidRevenue = 0;
  let walkInRevenue = 0;
  let walkInPaidRevenue = 0;

  normalizedSales.forEach((sale) => {
    const customerName = String(sale.customer || "").trim();
    const named = isNamedCustomer(customerName);
    const bucket = getRangeBucket(sale.dateObj, range);

    if (!trendGrouped[bucket.key]) {
      trendGrouped[bucket.key] = {
        label: bucket.label,
        sortValue: bucket.sortValue,
        namedRevenue: 0,
        walkInRevenue: 0,
        repeatRevenue: 0,
        namedCustomers: new Set(),
        repeatCustomers: new Set(),
      };
    }

    if (sale.status === "Paid") {
      paidRevenue += sale.total;
    }

    if (!named) {
      trendGrouped[bucket.key].walkInRevenue += sale.total;
      walkInRevenue += sale.total;
      if (sale.status === "Paid") {
        walkInPaidRevenue += sale.total;
      }
      return;
    }

    if (!customerMap[customerName]) {
      customerMap[customerName] = {
        customer: customerName,
        orders: 0,
        paidOrders: 0,
        revenue: 0,
        paidRevenue: 0,
        atRiskRevenue: 0,
        firstSeen: sale.dateObj,
        lastSeen: sale.dateObj,
        categories: {},
        channels: {},
        paymentMethods: {},
      };
    }

    const customer = customerMap[customerName];
    customer.orders += 1;
    customer.revenue += sale.total;

    if (sale.status === "Paid") {
      customer.paidOrders += 1;
      customer.paidRevenue += sale.total;
    } else {
      customer.atRiskRevenue += sale.total;
    }

    if (sale.dateObj < customer.firstSeen) customer.firstSeen = sale.dateObj;
    if (sale.dateObj > customer.lastSeen) customer.lastSeen = sale.dateObj;

    customer.channels[sale.channel] = (customer.channels[sale.channel] || 0) + sale.total;
    customer.paymentMethods[sale.paymentMethod] =
      (customer.paymentMethods[sale.paymentMethod] || 0) + 1;
    sale.items.forEach((item) => {
      const product = productMap[Number(item.id)] || {};
      const category = String(product.category || "General").trim() || "General";
      customer.categories[category] =
        (customer.categories[category] || 0) + toNumber(item.qty) * toNumber(item.price);
    });

    trendGrouped[bucket.key].namedRevenue += sale.total;
    trendGrouped[bucket.key].namedCustomers.add(customerName);
  });

  let customers = Object.values(customerMap)
    .map((entry) => {
      const daysSinceLastSeen = getDaysBetween(latestObservedAt, entry.lastSeen) ?? 0;
      let segment = "New";

      if (entry.orders >= 3 && daysSinceLastSeen <= 14) {
        segment = "Champion";
      } else if (entry.orders >= 2 && daysSinceLastSeen <= 21) {
        segment = "Repeat";
      } else if (daysSinceLastSeen >= 30) {
        segment = "Dormant";
      } else if (daysSinceLastSeen >= 14) {
        segment = "At Risk";
      }

      return {
        ...entry,
        averageOrderValue: entry.orders ? entry.revenue / entry.orders : 0,
        paidRate: entry.orders ? (entry.paidOrders / entry.orders) * 100 : 0,
        firstSeen: entry.firstSeen ? entry.firstSeen.toISOString() : null,
        lastSeen: entry.lastSeen ? entry.lastSeen.toISOString() : null,
        daysSinceLastSeen,
        segment,
        topCategory:
          Object.entries(entry.categories).sort((a, b) => b[1] - a[1])[0]?.[0] || "General",
        leadChannel:
          Object.entries(entry.channels).sort((a, b) => b[1] - a[1])[0]?.[0] || "In-Store",
        leadPaymentMethod:
          Object.entries(entry.paymentMethods).sort((a, b) => b[1] - a[1])[0]?.[0] || "Card",
      };
    })
    .sort((a, b) => b.paidRevenue - a.paidRevenue || b.orders - a.orders);

  const repeatCustomers = customers.filter((customer) => customer.orders >= 2);
  const repeatCustomerSet = new Set(repeatCustomers.map((customer) => customer.customer));

  normalizedSales.forEach((sale) => {
    const customerName = String(sale.customer || "").trim();
    if (!isNamedCustomer(customerName)) return;
    const bucket = getRangeBucket(sale.dateObj, range);
    if (repeatCustomerSet.has(customerName)) {
      trendGrouped[bucket.key].repeatRevenue += sale.total;
      trendGrouped[bucket.key].repeatCustomers.add(customerName);
    }
  });

  const trend = Object.values(trendGrouped)
    .sort((a, b) => a.sortValue - b.sortValue)
    .slice(-getRangeLimit(range))
    .map((entry) => ({
      label: entry.label,
      namedRevenue: entry.namedRevenue,
      walkInRevenue: entry.walkInRevenue,
      repeatRevenue: entry.repeatRevenue,
      uniqueCustomers: entry.namedCustomers.size,
      repeatCustomers: entry.repeatCustomers.size,
    }));

  const namedRevenue = customers.reduce((sum, customer) => sum + customer.paidRevenue, 0);
  const repeatRevenue = repeatCustomers.reduce((sum, customer) => sum + customer.paidRevenue, 0);
  customers = customers
    .map((customer) => {
      const cadenceDays =
        customer.orders > 1
          ? Number(
              (
                (getDaysBetween(customer.lastSeen, customer.firstSeen) || 0) /
                Math.max(customer.orders - 1, 1)
              ).toFixed(1)
            )
          : null;
      const customerShare = namedRevenue > 0 ? (toNumber(customer.paidRevenue) / namedRevenue) * 100 : 0;
      const pressureTone =
        customer.segment === "Dormant"
          ? "danger"
          : customer.segment === "At Risk"
            ? "warning"
            : customer.segment === "New"
              ? "neutral"
              : "success";
      const relationshipStatus =
        customer.segment === "Champion"
          ? "Protect and deepen"
          : customer.segment === "Repeat"
            ? "Convert to champion"
            : customer.segment === "New"
              ? "Needs second visit"
              : customer.segment === "At Risk"
                ? "Follow up now"
                : "Recovery needed";
      const watchSummary =
        customer.segment === "Champion"
          ? `${customer.orders} paid orders and ${formatMoneyValue(customer.paidRevenue)} already anchored by ${customer.topCategory}.`
          : customer.segment === "Repeat"
            ? `${customer.orders} paid orders with ${formatMoneyValue(customer.paidRevenue)} already showing repeat depth.`
            : customer.segment === "New"
              ? `Only ${customer.orders} named order on record. A second purchase is still needed.`
              : `${customer.daysSinceLastSeen} days since the last visit with ${formatMoneyValue(customer.paidRevenue)} now at risk.`;
      const recommendedAction =
        customer.segment === "Champion"
          ? `Protect ${customer.customer} with repeat offers around ${customer.topCategory} and keep the ${customer.leadChannel.toLowerCase()} path friction-free.`
          : customer.segment === "Repeat"
            ? `Push ${customer.customer} toward champion status with a next-order offer tied to ${customer.topCategory}.`
            : customer.segment === "New"
              ? `Turn ${customer.customer} into a second-visit account before the relationship cools.`
              : `Follow up with ${customer.customer} now before ${formatMoneyValue(customer.paidRevenue)} cools further.`;

      return {
        ...customer,
        cadenceDays,
        customerShare,
        pressureTone,
        relationshipStatus,
        watchSummary,
        recommendedAction,
        spendTier:
          customerShare >= 30
            ? "Anchor"
            : customerShare >= 18
              ? "Core"
              : customer.segment === "New"
                ? "Emerging"
                : "Developing",
      };
    })
    .sort((a, b) => b.paidRevenue - a.paidRevenue || b.orders - a.orders);

  const topCustomer = customers[0] || null;
  const topCustomerShare = namedRevenue > 0 ? (toNumber(topCustomer?.paidRevenue) / namedRevenue) * 100 : 0;
  const namedRevenueShare = paidRevenue > 0 ? (namedRevenue / paidRevenue) * 100 : 0;
  const walkInRevenueShare = paidRevenue > 0 ? (walkInPaidRevenue / paidRevenue) * 100 : 0;
  const atRiskCustomers = customers
    .filter((customer) => ["At Risk", "Dormant"].includes(customer.segment))
    .sort((a, b) => b.daysSinceLastSeen - a.daysSinceLastSeen || b.paidRevenue - a.paidRevenue)
    .slice(0, 5);
  const growingCustomers = customers
    .filter((customer) => ["Champion", "Repeat", "New"].includes(customer.segment))
    .sort((a, b) => b.paidRevenue - a.paidRevenue)
    .slice(0, 5);
  const segmentMix = [
    { label: "Champion", value: customers.filter((item) => item.segment === "Champion").length, fill: "#16a34a" },
    { label: "Repeat", value: customers.filter((item) => item.segment === "Repeat").length, fill: "#2563eb" },
    { label: "New", value: customers.filter((item) => item.segment === "New").length, fill: "#0f766e" },
    { label: "At Risk", value: customers.filter((item) => item.segment === "At Risk").length, fill: "#f59e0b" },
    { label: "Dormant", value: customers.filter((item) => item.segment === "Dormant").length, fill: "#dc2626" },
  ];
  const championCount = segmentMix.find((item) => item.label === "Champion")?.value || 0;
  const repeatCount = segmentMix.find((item) => item.label === "Repeat")?.value || 0;
  const newCount = segmentMix.find((item) => item.label === "New")?.value || 0;
  const atRiskCount = segmentMix.find((item) => item.label === "At Risk")?.value || 0;
  const dormantCount = segmentMix.find((item) => item.label === "Dormant")?.value || 0;
  const repeatCustomerRate = customers.length ? (repeatCustomers.length / customers.length) * 100 : 0;
  const coolingRevenue = atRiskCustomers.reduce((sum, customer) => sum + toNumber(customer.paidRevenue), 0);
  const averageDaysSinceLastSeen = customers.length
    ? customers.reduce((sum, customer) => sum + toNumber(customer.daysSinceLastSeen), 0) / customers.length
    : 0;
  const strongestSegment =
    [...segmentMix].sort((a, b) => b.value - a.value || (a.label === "Champion" ? -1 : 1))[0] || null;
  const watchtower = Array.from(
    new Map(
      [...atRiskCustomers, ...customers.slice(0, 4)].map((customer) => [
        customer.customer,
        {
          customer: customer.customer,
          tone: customer.pressureTone,
          headline: customer.watchSummary,
          action: customer.recommendedAction,
          metric: `${customer.segment} / ${customer.daysSinceLastSeen}d since last seen / ${formatMoneyValue(
            customer.paidRevenue
          )}`,
        },
      ])
    ).values()
  ).slice(0, 4);

  const executive = buildCustomersExecutive({
    customers,
    repeatCustomers,
    repeatRevenue,
    walkInRevenueShare,
    topCustomer,
    topCustomerShare,
  });
  const whyItMattersPoints = [];
  if (walkInRevenueShare > 0) {
    whyItMattersPoints.push(
      `${walkInRevenueShare.toFixed(1)}% of paid revenue is still anonymous, so known demand is not yet fully defensive.`
    );
  }
  if (repeatRevenue > 0) {
    whyItMattersPoints.push(
      `Repeat demand already contributes ${formatMoneyValue(repeatRevenue)} across ${repeatCustomers.length} returning customers.`
    );
  }
  if (topCustomer) {
    whyItMattersPoints.push(
      `${topCustomer.customer} is carrying ${topCustomerShare.toFixed(1)}% of named revenue and deserves protection.`
    );
  }
  if (coolingRevenue > 0) {
    whyItMattersPoints.push(
      `${atRiskCustomers.length} cooling accounts represent ${formatMoneyValue(coolingRevenue)} that can still be recovered.`
    );
  }
  if (!whyItMattersPoints.length) {
    whyItMattersPoints.push(
      "Customer demand is still mostly anonymous, so the owner has limited repeat-behavior signal to defend."
    );
  }

  const whatChangedPoints = [];
  if (customers.length > 0) {
    whatChangedPoints.push(
      `${customers.length} named customers are visible, with ${championCount} champion and ${repeatCount} repeat accounts currently on record.`
    );
  }
  if (namedRevenue > 0) {
    whatChangedPoints.push(
      `Named customers are driving ${formatMoneyValue(namedRevenue)} or ${namedRevenueShare.toFixed(1)}% of paid revenue.`
    );
  }
  if (strongestSegment?.value) {
    whatChangedPoints.push(
      `${strongestSegment.label} is the heaviest visible segment at ${strongestSegment.value} tracked accounts.`
    );
  }
  if (averageDaysSinceLastSeen > 0) {
    whatChangedPoints.push(
      `Average recency across named customers is ${averageDaysSinceLastSeen.toFixed(1)} days since the last visit.`
    );
  }
  if (!whatChangedPoints.length) {
    whatChangedPoints.push("No named-customer history is visible yet.");
  }

  const actionPlan = Array.from(
    new Set(
      [
        topCustomer?.recommendedAction,
        atRiskCustomers[0]?.recommendedAction,
        customers.find((item) => item.segment === "New")?.recommendedAction,
      ].filter(Boolean)
    )
  ).slice(0, 3);

  return {
    summary: {
      totalCustomers: customers.length,
      namedRevenue,
      namedRevenueShare,
      repeatCustomerRate,
      repeatRevenue,
      walkInRevenue,
      walkInRevenueShare,
      topCustomerShare,
      topCustomer: topCustomer?.customer || "No clear leader yet",
      championCount,
      repeatCount,
      newCount,
      atRiskCount,
      dormantCount,
      coolingRevenue,
      averageDaysSinceLastSeen,
      strongestSegment: strongestSegment?.label || "Still forming",
    },
    executiveSummary: {
      ...executive,
      whyItMattersPoints,
      whatChangedPoints,
      actionPlan,
      actions: [
        {
          label: "Review customer momentum",
          note: "See how named, walk-in, and repeat revenue are moving.",
          focus: "customers-momentum",
        },
        {
          label: "Inspect the customer directory",
          note: "Open the highest-value customers and their current segment.",
          focus: "customers-directory",
        },
        {
          label: "Check the retention watchlist",
          note: "See which customers are cooling off and need follow-through.",
          focus: "customers-retention",
        },
      ],
    },
    actionSignals: [
      {
        title: "Walk-in Dependence",
        value: `${walkInRevenueShare.toFixed(1)}%`,
        message:
          walkInRevenueShare >= 70
            ? "Too much paid revenue is still anonymous."
            : "Walk-in share is no longer dominating the whole mix.",
        tone: walkInRevenueShare >= 70 ? "warning" : "success",
        focus: "customers-momentum",
      },
      {
        title: "Repeat Revenue",
        value: formatMoneyValue(repeatRevenue),
        message:
          repeatRevenue > 0
            ? "This is the part of customer demand already proving it can come back."
            : "Repeat demand is still too light to anchor the business.",
        tone: repeatRevenue > 0 ? "success" : "warning",
        focus: "customers-retention",
      },
      {
        title: "Lead Customer",
        value: topCustomer?.customer || "No leader yet",
        message: topCustomer
          ? `${topCustomer.orders} orders with ${topCustomer.daysSinceLastSeen} days since the last visit.`
          : "The top customer signal sharpens as more named orders land.",
        tone: topCustomer ? "success" : "warning",
        focus: "customers-directory",
      },
      {
        title: "At-Risk Accounts",
        value: atRiskCustomers.length > 0 ? formatMoneyValue(coolingRevenue) : "0",
        message:
          atRiskCustomers.length > 0
            ? "Named customers are cooling off and deserve follow-up attention before revenue slips."
            : "No named account is currently cooling off hard enough to flag.",
        tone: atRiskCustomers.length > 0 ? "warning" : "success",
        focus: "customers-retention",
      },
    ],
    trend,
    segmentMix,
    customers,
    topCustomers: customers.slice(0, 6),
    atRiskCustomers,
    growingCustomers,
    watchtower,
  };
}

export function buildSuppliersFallbackDataset({
  products = [],
  purchaseOrders = [],
}) {
  const productList = Array.isArray(products) ? products : [];
  const orderList = Array.isArray(purchaseOrders) ? purchaseOrders : [];
  const supplierMap = {};
  const now = new Date();

  const ensureSupplier = (name) => {
    const supplierName = String(name || "General Supplier").trim() || "General Supplier";
    if (!supplierMap[supplierName]) {
      supplierMap[supplierName] = {
        supplier: supplierName,
        skuCount: 0,
        unitsOnHand: 0,
        inventoryValue: 0,
        lowStockLines: 0,
        criticalLines: 0,
        dormantValue: 0,
        openPoCount: 0,
        openPoValue: 0,
        openUnits: 0,
        totalPoCount: 0,
        lateOrders: 0,
        unitsOrdered: 0,
        unitsReceived: 0,
        leadTimes: [],
        lastDeliveryAt: null,
        exposedSkuCount: 0,
        exposedInventoryValue: 0,
        exposureUrgency: 0,
        topExposure: null,
      };
    }
    return supplierMap[supplierName];
  };

  const buildServiceScore = (entry, fillRate, avgLeadTimeDays) => {
    const fillComponent = entry.unitsOrdered > 0 ? Math.min(fillRate, 100) : 72;
    const leadComponent =
      avgLeadTimeDays === null || avgLeadTimeDays === undefined
        ? 72
        : Math.max(34, 100 - Math.min(avgLeadTimeDays * 9, 58));
    const stockComponent = Math.max(0, 100 - entry.criticalLines * 22 - entry.lowStockLines * 8);
    const reliabilityComponent = Math.max(
      0,
      100 - entry.lateOrders * 18 - Math.max(entry.openPoCount - 2, 0) * 8
    );

    return Math.max(
      0,
      Math.min(
        100,
        Math.round(
          fillComponent * 0.42 +
            leadComponent * 0.18 +
            stockComponent * 0.24 +
            reliabilityComponent * 0.16
        )
      )
    );
  };

  const buildPressureReasons = (entry, fillRate, avgLeadTimeDays) => {
    const reasons = [];

    if (entry.topExposure) {
      const coverText =
        entry.topExposure.estimatedDaysCover === null || entry.topExposure.estimatedDaysCover === undefined
          ? "cover is not measurable yet"
          : `${Number(entry.topExposure.estimatedDaysCover).toFixed(1)} days cover`;
      reasons.push(
        `${entry.topExposure.name} is the most exposed SKU with ${entry.topExposure.stock} units and ${coverText}.`
      );
    }

    if (entry.criticalLines > 0 && entry.openPoCount === 0) {
      reasons.push(`${entry.criticalLines} critical lines have no inbound cover right now.`);
    }

    if (entry.lateOrders > 0) {
      reasons.push(`${entry.lateOrders} commitments are already past expected receipt.`);
    }

    if (fillRate > 0 && fillRate < 82) {
      reasons.push(`Fill rate is only ${fillRate.toFixed(1)}% across tracked ordered units.`);
    }

    if (avgLeadTimeDays && avgLeadTimeDays > 6) {
      reasons.push(`Average lead time is ${avgLeadTimeDays.toFixed(1)} days, which is starting to stretch response time.`);
    }

    if (!reasons.length && entry.openPoCount > 0) {
      reasons.push(`${entry.openPoCount} commitments worth ${entry.openPoValue.toFixed(2)} are still waiting to land.`);
    }

    if (!reasons.length) {
      reasons.push("No immediate supplier break is visible in stock cover, fill quality, or inbound commitments.");
    }

    return reasons.slice(0, 4);
  };

  const buildRecommendedAction = (entry, fillRate) => {
    if (entry.criticalLines > 0 && entry.openPoCount === 0) {
      return `Raise an immediate replenishment call with ${entry.supplier} and protect ${entry.topExposure?.name || "the exposed SKU"} first.`;
    }

    if (entry.lateOrders > 0) {
      return `Follow up on the late commitments with ${entry.supplier} and confirm revised receipt timing today.`;
    }

    if (fillRate > 0 && fillRate < 82) {
      return `Review partial receipts from ${entry.supplier} and tighten the next order before stock pressure deepens.`;
    }

    if (entry.openPoCount > 0) {
      return `Close the largest open commitment from ${entry.supplier} before it turns from planned stock into a floor issue.`;
    }

    if (entry.topExposure) {
      return `Keep ${entry.topExposure.name} protected and monitor ${entry.supplier} for the next reorder cycle.`;
    }

    return `Keep ${entry.supplier} on watch while supplier history deepens.`;
  };

  productList.forEach((product) => {
    const supplier = ensureSupplier(product.supplier);
    supplier.skuCount += 1;
    supplier.unitsOnHand += toNumber(product.stock);
    supplier.inventoryValue += toNumber(product.stock) * toNumber(product.price);
    if (toNumber(product.stock) <= 10) supplier.lowStockLines += 1;
    if (toNumber(product.stock) <= 5) supplier.criticalLines += 1;
    if (toNumber(product.stock) > 0 && toNumber(product.stock) * toNumber(product.price) >= 150) {
      supplier.dormantValue += 0;
    }

    if (toNumber(product.stock) <= 10) {
      const stock = toNumber(product.stock);
      const stockValue = stock * toNumber(product.price);
      const urgencyScore =
        (stock <= 0 ? 100 : stock <= 5 ? 80 : 60) +
        (stockValue > 500 ? 10 : stockValue > 250 ? 5 : 0);

      supplier.exposedSkuCount += 1;
      supplier.exposedInventoryValue += stockValue;
      supplier.exposureUrgency += urgencyScore;

      if (
        !supplier.topExposure ||
        urgencyScore > toNumber(supplier.topExposure.urgencyScore) ||
        (urgencyScore === toNumber(supplier.topExposure.urgencyScore) &&
          stockValue > toNumber(supplier.topExposure.stockValue))
      ) {
        supplier.topExposure = {
          id: product.id,
          name: product.name,
          sku: product.sku,
          category: product.category,
          stock,
          stockValue,
          estimatedDaysCover: null,
          urgencyScore,
          status: stock <= 5 ? "Critical" : "Reorder Soon",
        };
      }
    }
  });

  orderList.forEach((order) => {
    const supplier = ensureSupplier(order.supplier);
    const status = String(order.status || "Draft").trim();
    supplier.totalPoCount += 1;
    supplier.unitsOrdered += toNumber(order.unitsOrdered);
    supplier.unitsReceived += toNumber(order.unitsReceived);

    if (!["Received", "Cancelled"].includes(status)) {
      supplier.openPoCount += 1;
      supplier.openPoValue += toNumber(order.totalEstimatedCost);
      supplier.openUnits += toNumber(order.openUnits);
    }

    if (order.expectedDate && !["Received", "Cancelled"].includes(status)) {
      const expectedDate = safeDate(order.expectedDate);
      if (expectedDate && expectedDate < now) {
        supplier.lateOrders += 1;
      }
    }

    const receivedAt = safeDate(order.receivedAt);
    const leadStart = safeDate(order.sentAt || order.createdAt);
    if (receivedAt) {
      supplier.lastDeliveryAt =
        !supplier.lastDeliveryAt || receivedAt > supplier.lastDeliveryAt
          ? receivedAt
          : supplier.lastDeliveryAt;
      if (leadStart) {
        const leadTime = getDaysBetween(receivedAt, leadStart);
        if (leadTime !== null) supplier.leadTimes.push(leadTime);
      }
    }
  });

  const openOrders = orderList
    .filter((order) => !["Received", "Cancelled"].includes(String(order.status || "Draft").trim()))
    .sort((a, b) => toNumber(b.totalEstimatedCost) - toNumber(a.totalEstimatedCost))
    .slice(0, 6)
    .map((order) => ({
      id: order.id,
      supplier: order.supplier,
      status: order.status,
      value: toNumber(order.totalEstimatedCost),
      openUnits: toNumber(order.openUnits),
      expectedDate: order.expectedDate || null,
    }));

  const suppliers = Object.values(supplierMap)
    .map((entry) => {
      const fillRate = entry.unitsOrdered > 0 ? (entry.unitsReceived / entry.unitsOrdered) * 100 : 0;
      const avgLeadTimeDays = entry.leadTimes.length
        ? entry.leadTimes.reduce((sum, value) => sum + value, 0) / entry.leadTimes.length
        : null;
      let pressureTone = "success";
      let status = "Stable";
      let riskScore =
        entry.criticalLines * 24 +
        entry.lowStockLines * 10 +
        entry.lateOrders * 18 +
        (entry.openPoCount === 0 && entry.lowStockLines > 0 ? 18 : 0) +
        (fillRate > 0 && fillRate < 85 ? (85 - fillRate) * 0.8 : 0) +
        (avgLeadTimeDays ? Math.max(avgLeadTimeDays - 5, 0) * 2 : 0);

      if (entry.criticalLines > 0 && entry.openPoCount === 0) {
        pressureTone = "danger";
        status = "Uncovered";
        riskScore += 20;
      } else if (entry.lateOrders > 0 || (fillRate > 0 && fillRate < 70) || entry.criticalLines > 1) {
        pressureTone = "danger";
        status = "Pressure";
      } else if (entry.lowStockLines > 0 || entry.openPoCount > 0 || (fillRate > 0 && fillRate < 90)) {
        pressureTone = "warning";
        status = "Watch";
      }

      const serviceScore = buildServiceScore(entry, fillRate, avgLeadTimeDays);
      const pressureReasons = buildPressureReasons(entry, fillRate, avgLeadTimeDays);
      const recommendedAction = buildRecommendedAction(entry, fillRate);

      return {
        ...entry,
        fillRate,
        avgLeadTimeDays,
        lastDeliveryAt: entry.lastDeliveryAt ? entry.lastDeliveryAt.toISOString() : null,
        riskScore: Number(riskScore.toFixed(1)),
        serviceScore,
        pressureTone,
        status,
        pressureReasons,
        recommendedAction,
        watchSummary: pressureReasons[0],
      };
    })
    .sort((a, b) => b.riskScore - a.riskScore || b.openPoValue - a.openPoValue || b.inventoryValue - a.inventoryValue);

  const totalOrderedUnits = suppliers.reduce((sum, supplier) => sum + supplier.unitsOrdered, 0);
  const totalReceivedUnits = suppliers.reduce((sum, supplier) => sum + supplier.unitsReceived, 0);
  const weightedFillRate = totalOrderedUnits > 0 ? (totalReceivedUnits / totalOrderedUnits) * 100 : 0;
  const leadTimes = suppliers.map((supplier) => supplier.avgLeadTimeDays).filter((value) => Number.isFinite(value));
  const averageLeadTime = leadTimes.length ? leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length : 0;
  const openCommitmentValue = suppliers.reduce((sum, supplier) => sum + supplier.openPoValue, 0);
  const atRiskSuppliers = suppliers.filter((supplier) => supplier.pressureTone !== "success");
  const leadSupplier = suppliers[0] || null;
  const openPoCount = suppliers.reduce((sum, supplier) => sum + supplier.openPoCount, 0);
  const lateCommitments = suppliers.reduce((sum, supplier) => sum + supplier.lateOrders, 0);
  const uncoveredCriticalLines = suppliers.reduce(
    (sum, supplier) => sum + (supplier.criticalLines > 0 && supplier.openPoCount === 0 ? supplier.criticalLines : 0),
    0
  );
  const exposedSkuCount = suppliers.reduce((sum, supplier) => sum + supplier.exposedSkuCount, 0);
  const serviceScore =
    suppliers.length > 0
      ? suppliers.reduce((sum, supplier) => sum + supplier.serviceScore, 0) / suppliers.length
      : 0;

  let statusTone = "success";
  let headline = "Supplier cover is stable enough to operate cleanly.";
  let summary = `${suppliers.length} suppliers are active and open purchase-order exposure is ${openCommitmentValue.toFixed(
    2
  )}.`;
  let whyItMatters =
    "Stable supplier execution keeps replenishment predictable and prevents stock pressure from turning urgent.";
  let nextMove = leadSupplier
    ? `Keep ${leadSupplier.supplier} under review and close the highest open supplier commitment first.`
    : "Keep receiving discipline clean as supplier history builds.";

  if (!suppliers.length) {
    statusTone = "warning";
    headline = "Supplier intelligence is still empty.";
    summary =
      "Products exist, but supplier-linked inventory and purchase-order history are still too thin to guide replenishment.";
    whyItMatters =
      "Without supplier data, the business cannot see who is slow, risky, or already overexposed.";
    nextMove = "Keep supplier names consistent on products and purchase orders.";
  } else if (leadSupplier && leadSupplier.pressureTone === "danger") {
    statusTone = "danger";
    headline = "Supplier pressure is already touching stock continuity.";
    summary = `${leadSupplier.supplier} is carrying ${leadSupplier.lowStockLines} low-stock lines with ${leadSupplier.openPoCount} open purchase orders and ${leadSupplier.lateOrders} late commitments.`;
    whyItMatters =
      "When supplier pressure and stock pressure overlap, the floor loses continuity fast.";
    nextMove =
      leadSupplier.openPoCount > 0
        ? `Chase receiving follow-through with ${leadSupplier.supplier} before exposed SKUs fall through.`
        : `Raise a supplier escalation for ${leadSupplier.supplier} before exposed SKUs go dark.`;
  } else if (weightedFillRate > 0 && weightedFillRate < 82) {
    statusTone = "warning";
    headline = "Suppliers are shipping, but fill quality is soft.";
    summary = `Tracked supplier fill rate is ${weightedFillRate.toFixed(1)}% and open commitment value is ${openCommitmentValue.toFixed(
      2
    )}.`;
    whyItMatters =
      "Slow or partial receiving makes inventory look covered when it is still operationally exposed.";
    nextMove = "Close the biggest open commitments and watch the suppliers with the weakest fill rate.";
  } else if (openCommitmentValue > 0) {
    statusTone = "warning";
    headline = "Receiving follow-through is the main supplier job right now.";
    summary = `${openCommitmentValue.toFixed(2)} is still sitting in open purchase orders across ${suppliers.reduce(
      (sum, supplier) => sum + supplier.openPoCount,
      0
    )} commitments.`;
    whyItMatters = "The stock may be planned, but it is not real until it has landed cleanly.";
    nextMove = "Work the largest open commitments first and confirm the exposed lines have real inbound cover.";
  }

  const whyItMattersPoints = [];
  if (leadSupplier) {
    whyItMattersPoints.push(
      `${leadSupplier.supplier} is carrying ${leadSupplier.lowStockLines} low-stock lines and ${leadSupplier.exposedSkuCount} exposed SKUs in the current inventory picture.`
    );
  }
  if (openCommitmentValue > 0) {
    whyItMattersPoints.push(
      `${openPoCount} open commitments are still sitting outside received stock, so planned cover is not real cover yet.`
    );
  }
  if (uncoveredCriticalLines > 0) {
    whyItMattersPoints.push(
      `${uncoveredCriticalLines} critical supplier lines currently have no inbound cover attached to them.`
    );
  }
  if (!whyItMattersPoints.length) {
    whyItMattersPoints.push(
      "Supplier cover, fill quality, and inbound commitments are not showing a broad continuity break right now."
    );
  }

  const whatChangedPoints = [];
  if (weightedFillRate > 0) {
    whatChangedPoints.push(`Weighted fill rate is ${weightedFillRate.toFixed(1)}% across tracked supplier receipts.`);
  }
  if (lateCommitments > 0) {
    whatChangedPoints.push(`${lateCommitments} commitments are already late and need follow-through.`);
  }
  if (atRiskSuppliers.length > 0) {
    whatChangedPoints.push(`${atRiskSuppliers.length} suppliers are currently on watch because of stock, fill, or receiving pressure.`);
  }
  if (leadSupplier?.topExposure) {
    whatChangedPoints.push(
      `${leadSupplier.topExposure.name} is the lead exposed SKU and is anchoring the next supplier decision.`
    );
  }
  if (!whatChangedPoints.length) {
    whatChangedPoints.push("No negative supplier drift is visible in the current tracked history.");
  }

  const actionPlan = suppliers.length
    ? suppliers
        .slice(0, 3)
        .map((supplier) => supplier.recommendedAction)
        .filter(Boolean)
    : [nextMove];

  return {
    summary: {
      supplierCount: suppliers.length,
      openCommitmentValue,
      weightedFillRate,
      averageLeadTime,
      atRiskSuppliers: atRiskSuppliers.length,
      leadSupplier: leadSupplier?.supplier || "No clear watchpoint",
      openPoCount,
      lateCommitments,
      uncoveredCriticalLines,
      exposedSkuCount,
      serviceScore: Number(serviceScore.toFixed(1)),
    },
    executiveSummary: {
      statusTone,
      headline,
      summary,
      whyItMatters,
      nextMove,
      whyItMattersPoints,
      whatChangedPoints,
      actionPlan,
      actions: [
        {
          label: "Review supplier service quality",
          note: "See fill-rate and open-value pressure by supplier.",
          focus: "suppliers-service",
        },
        {
          label: "Open the supplier directory",
          note: "Inspect who is stable, who is pressured, and what needs follow-through.",
          focus: "suppliers-directory",
        },
        {
          label: "Check open commitments",
          note: "Go straight to the biggest open purchase orders.",
          focus: "suppliers-open-orders",
        },
      ],
    },
    actionSignals: [
      {
        title: "Open Commitments",
        value: `${openCommitmentValue.toFixed(2)}`,
        message:
          openCommitmentValue > 0
            ? "Purchase-order value is still sitting outside received stock."
            : "No supplier commitment is waiting to be received right now.",
        tone: openCommitmentValue > 0 ? "warning" : "success",
        focus: "suppliers-open-orders",
      },
      {
        title: "Tracked Fill Rate",
        value: `${weightedFillRate.toFixed(1)}%`,
        message:
          weightedFillRate > 0
            ? "This is the cleanest read on how fully suppliers are landing what was ordered."
            : "Fill-rate history will appear once received purchase orders build up.",
        tone: weightedFillRate > 0 && weightedFillRate < 82 ? "warning" : "success",
        focus: "suppliers-service",
      },
      {
        title: "Average Lead Time",
        value: `${averageLeadTime.toFixed(1)} days`,
        message:
          averageLeadTime > 0
            ? "Shorter lead times give the owner more room before low-stock pressure turns urgent."
            : "Lead-time history appears once more orders are received.",
        tone: averageLeadTime > 8 ? "warning" : "success",
        focus: "suppliers-service",
      },
      {
        title: "Supplier Pressure",
        value: `${atRiskSuppliers.length}`,
        message:
          atRiskSuppliers.length > 0
            ? "Suppliers are already on watch because of stock, fill, or receiving pressure."
            : "No supplier is under meaningful pressure right now.",
        tone: atRiskSuppliers.length > 0 ? "warning" : "success",
        focus: "suppliers-directory",
      },
    ],
    watchtower: suppliers.slice(0, 4).map((supplier) => ({
      supplier: supplier.supplier,
      tone: supplier.pressureTone,
      headline: supplier.watchSummary,
      action: supplier.recommendedAction,
      metric: `${supplier.lowStockLines} low-stock lines / ${supplier.openPoCount} open POs / ${supplier.serviceScore}/100 service`,
    })),
    suppliers,
    topSuppliers: suppliers.slice(0, 6),
    openOrders,
  };
}

export function isCustomersDatasetThin(data) {
  const summary = data?.summary || {};
  return !Array.isArray(data?.customers) || data.customers.length === 0 || Number(summary.namedRevenue || 0) === 0;
}

export function isSuppliersDatasetThin(data) {
  const summary = data?.summary || {};
  return !Array.isArray(data?.suppliers) || data.suppliers.length === 0 || Number(summary.supplierCount || 0) === 0;
}
