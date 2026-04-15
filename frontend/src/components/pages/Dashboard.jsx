import { startTransition, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  FaArrowTrendUp as FiActivity,
  FaBoxArchive as FiPackage,
  FaChartColumn as FiBarChart2,
  FaShieldHalved as FiShield,
} from "react-icons/fa6";

import API from "../../api/api";
import { LIVE_PAGE_POLL_INTERVAL_MS } from "./pageRuntime";
import {
  ANALYTICAL_BLUE_ACCENT,
  ANALYTICAL_BLUE_DEEP,
  ANALYTICAL_BLUE_FAINT,
  ANALYTICAL_BLUE_MID,
  ANALYTICAL_BLUE_PALE,
  ANALYTICAL_BLUE_SOFT,
} from "./shared/chartTheme";
import {
  firstArrayFrom,
  firstNumberFrom,
  formatDate,
  formatMoney,
  formatPercent,
  getResponseData,
  toObject,
} from "./shared/dataHelpers";
import { getProductVisual } from "./shared/productVisuals";

function dashboardTone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (
    normalized.includes("live") ||
    normalized.includes("paid") ||
    normalized.includes("healthy") ||
    normalized.includes("ready")
  ) {
    return "success";
  }
  if (
    normalized.includes("pending") ||
    normalized.includes("watch") ||
    normalized.includes("pressure") ||
    normalized.includes("deferred") ||
    normalized.includes("loading")
  ) {
    return "warning";
  }
  if (
    normalized.includes("risk") ||
    normalized.includes("refund") ||
    normalized.includes("failed") ||
    normalized.includes("critical")
  ) {
    return "danger";
  }
  return "neutral";
}

function DashboardActionButton({ item, navigate }) {
  const handleClick = () => {
    if (item.to) {
      navigate(item.to);
      return;
    }
    item.onClick?.();
  };

  return (
    <button type="button" className="dashboard-ref-action" onClick={handleClick}>
      <span className="dashboard-ref-action-copy">
        <small>{item.eyebrow}</small>
        <strong>{item.title}</strong>
      </span>
      {item.badge ? <span className={`status-pill small ${dashboardTone(item.badge)}`}>{item.badge}</span> : null}
    </button>
  );
}

function DashboardProductRow({ item, currency }) {
  const visual = getProductVisual(item);
  const revenue = firstNumberFrom(item, ["revenue", "value", "sales"]);
  const units = firstNumberFrom(item, ["units", "quantitySold", "orders"]);

  return (
    <article className="dashboard-ref-product-row">
      <div className={`product-thumb product-thumb--${visual.tone}`}>
        <img src={visual.image} alt={visual.alt} />
      </div>
      <div className="dashboard-ref-product-copy">
        <strong>{item?.name || item?.sku || "Product"}</strong>
        <small>{item?.category || item?.supplier || item?.sku || "Live catalog item"}</small>
      </div>
      <div className="dashboard-ref-product-meta">
        <strong>{formatMoney(currency, revenue)}</strong>
        <small>{units ? `${units} units` : "live"}</small>
      </div>
    </article>
  );
}

function Dashboard({ settings }) {
  const navigate = useNavigate();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [refreshNonce, _setRefreshNonce] = useState(0);

  const currency = settings?.currency || "CAD";
  const normalizePercent = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return numeric <= 1 ? numeric * 100 : numeric;
  };

  useEffect(() => {
    let cancelled = false;

    const loadDashboard = async ({ silent = false } = {}) => {
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        const response = await API.get("/reports/dashboard");
        const data = getResponseData(response) || {};
        if (cancelled) return;

        startTransition(() => {
          setPayload(data);
          setLastUpdated(new Date().toISOString());
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError?.message || "Could not load dashboard data.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    };

    loadDashboard();
    const timer = window.setInterval(() => {
      loadDashboard({ silent: true });
    }, LIVE_PAGE_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [refreshNonce]);

  const summary = useMemo(() => toObject(payload?.stats || payload?.summary), [payload]);
  const trend = useMemo(() => {
    const revenueTrend = firstArrayFrom(payload, ["revenueTrend", "trend", "dailyTrend"]);
    const statusTrend = firstArrayFrom(payload, ["statusTrend"]);
    const statusMap = new Map(
      statusTrend.map((entry, index) => [
        String(entry?.label || entry?.time || entry?.date || entry?.period || `P-${index + 1}`),
        entry,
      ])
    );
    const source = revenueTrend.length ? revenueTrend : statusTrend;

    return source.map((entry, index) => {
      const label = String(entry?.label || entry?.time || entry?.date || entry?.period || `P-${index + 1}`);
      const statusEntry = statusMap.get(label) || statusTrend[index] || {};
      const paidRateRaw = firstNumberFrom(statusEntry, ["paidRate", "collectionRate"]);

      return {
        label,
        revenue: firstNumberFrom(entry, ["revenue", "capturedRevenue", "totalRevenue", "paidRevenue"]),
        orders: firstNumberFrom(entry, ["orders", "count", "orderCount", "totalOrders", "paidOrders"]),
        paidRatePct: normalizePercent(paidRateRaw),
      };
    });
  }, [payload]);
  const topProducts = useMemo(() => {
    const direct = firstArrayFrom(payload, ["topProducts"]);
    const fallback = Array.isArray(payload?.productPerformance?.topProducts)
      ? payload.productPerformance.topProducts
      : [];
    return (direct.length ? direct : fallback).slice(0, 6);
  }, [payload]);
  const lowStock = useMemo(
    () => firstArrayFrom(payload, ["lowStock", "reorderNow", "inventoryAlerts"]).slice(0, 8),
    [payload]
  );
  const recentSales = useMemo(() => firstArrayFrom(payload, ["recentSales", "sales"]).slice(0, 8), [payload]);
  const briefing = useMemo(() => toObject(payload?.dailyBriefing), [payload]);
  const whatChanged = useMemo(() => firstArrayFrom(payload, ["whatChanged"]).slice(0, 5), [payload]);
  const recommendations = useMemo(
    () => firstArrayFrom(payload, ["recommendations", "smartAlerts", "actionSignals"]).slice(0, 5),
    [payload]
  );
  const mlForecast = useMemo(() => toObject(payload?.mlForecast), [payload]);
  const mlSummary = useMemo(() => toObject(mlForecast?.modelSummary), [mlForecast]);
  const mlPortfolioSummary = useMemo(() => toObject(mlForecast?.portfolioSummary), [mlForecast]);
  const mlFoundation = useMemo(() => toObject(mlForecast?.dataFoundation), [mlForecast]);
  const mlPeriods = useMemo(() => firstArrayFrom(mlForecast, ["periods"]).slice(0, 6), [mlForecast]);
  const mlQualityWarnings = useMemo(
    () => firstArrayFrom(mlFoundation, ["qualityWarnings"]).slice(0, 3),
    [mlFoundation]
  );

  const revenue = firstNumberFrom(summary, ["capturedRevenue", "revenue", "totalRevenue"]);
  const orderCount = firstNumberFrom(summary, ["totalOrders", "orders", "orderCount", "paidOrders"]);
  const averageOrderValue = firstNumberFrom(summary, ["averageOrderValue", "avgOrderValue", "aov"]);
  const paidRate = firstNumberFrom(summary, ["paidRate", "collectionRate"]);
  const protectedRevenue = firstNumberFrom(mlPortfolioSummary, ["protectedRevenue"]);
  const prioritySpend = firstNumberFrom(mlPortfolioSummary, ["highPriorityOrderSpend"]);
  const deferredSkuCount = firstNumberFrom(mlPortfolioSummary, ["deferredSkuCount"]);

  const projectionSeries = useMemo(
    () =>
      mlPeriods.map((entry, index) => ({
        label: String(entry?.label || `F-${index + 1}`),
        projectedRevenue: firstNumberFrom(entry, ["projectedRevenue"]),
        projectedRevenueLower: firstNumberFrom(entry, ["projectedRevenueLower"]),
        projectedRevenueUpper: firstNumberFrom(entry, ["projectedRevenueUpper"]),
      })),
    [mlPeriods]
  );

  const decisionQueue = recommendations.length ? recommendations : whatChanged;
  const leadLowStock = lowStock[0] || null;

  const commandDeckItems = [
    {
      key: "inventory",
      eyebrow: "Inventory",
      title: "Open replenishment",
      badge: leadLowStock ? "stock pressure" : "balanced",
      onClick: () =>
        navigate("/pos-dashboard", {
          state: {
            assistantActionLabel: "Inventory pressure board",
            assistantActionNote: "The replenishment workspace is opened with the reorder queue ready for action.",
            inventoryFocus: "inventory-reorder-planner",
          },
        }),
    },
    {
      key: "reports",
      eyebrow: "Strategy",
      title: "Review forecasts",
      badge: mlSummary?.method || "live model",
      to: "/reports",
    },
    {
      key: "terminal",
      eyebrow: "Commerce",
      title: "Open terminal",
      badge: recentSales[0]?.status || "lane ready",
      to: "/terminal",
    },
    {
      key: "workforce",
      eyebrow: "Workforce",
      title: "Check staff",
      badge: `${deferredSkuCount} deferred`,
      to: "/users",
    },
  ];

  const summaryCards = [
    {
      label: "Revenue Today",
      value: formatMoney(currency, revenue),
      note: `${formatPercent(paidRate)} paid today`,
      icon: FiBarChart2,
    },
    {
      label: "Total Orders",
      value: `${orderCount}`,
      note: `${formatMoney(currency, averageOrderValue)} average order`,
      icon: FiActivity,
    },
    {
      label: "Low Stock Items",
      value: `${lowStock.length}`,
      note: leadLowStock?.name || "Inventory balanced",
      icon: FiPackage,
    },
    {
      label: "Protected Revenue",
      value: formatMoney(currency, protectedRevenue),
      note: `${deferredSkuCount} deferred SKUs under model watch`,
      icon: FiShield,
    },
  ];

  return (
    <div className="page-container dashboard-page dashboard-reference-page">
      {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}

      <section className="dashboard-ref-hero">
        <div className="dashboard-ref-hero-copy">
          <span className="dashboard-ref-kicker">Executive dashboard</span>
          <h1>
            Welcome back to <span>{settings?.storeName || "AfroSpice"}</span>
          </h1>
          <p>Run your store with a smarter, cleaner control surface.</p>

          <div className="dashboard-ref-action-row">
            {commandDeckItems.map((item) => (
              <DashboardActionButton key={item.key} item={item} navigate={navigate} />
            ))}
          </div>

          <div className="dashboard-ref-toolbar" />
        </div>

        <aside className="dashboard-ref-spotlight">
          <div className="dashboard-ref-spotlight-copy">
            <span className="dashboard-ref-spotlight-label">Protected revenue</span>
            <strong>{formatMoney(currency, protectedRevenue)}</strong>
            <small>{refreshing ? "Refreshing live data..." : `Updated ${formatDate(lastUpdated)}`}</small>
          </div>

          <div className="dashboard-ref-mini-chart">
            {trend.length ? (
              <ResponsiveContainer width="100%" height={126}>
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="dashboardSpotlightFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ANALYTICAL_BLUE_ACCENT} stopOpacity="0.34" />
                      <stop offset="58%" stopColor={ANALYTICAL_BLUE_MID} stopOpacity="0.16" />
                      <stop offset="100%" stopColor={ANALYTICAL_BLUE_FAINT} stopOpacity="0.04" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} hide />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "14px",
                      color: "var(--text-primary)",
                    }}
                    formatter={(value) => formatMoney(currency, value)}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke={ANALYTICAL_BLUE_DEEP}
                    fill="url(#dashboardSpotlightFill)"
                    strokeWidth={2.6}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : null}
          </div>

          <div className="dashboard-ref-spotlight-meta">
            <div>
              <span>Next capital call</span>
              <strong>{formatMoney(currency, prioritySpend)}</strong>
            </div>
            <div>
              <span>Owner brief</span>
              <strong>{briefing?.headline || "Live model watch is active."}</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="dashboard-ref-metric-row">
        {summaryCards.map((metric) => (
          <article key={metric.label} className="dashboard-ref-metric-card">
            <div className="reference-stat-head">
              <div className="reference-stat-icon">{metric.icon ? <metric.icon /> : null}</div>
            </div>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.note}</small>
          </article>
        ))}
      </section>

      <section className="dashboard-ref-main-grid">
        <article className="dashboard-ref-panel dashboard-ref-panel--chart">
          <header className="dashboard-ref-panel-head">
            <div>
              <span className="dashboard-ref-panel-kicker">Revenue overview</span>
              <h3>Commercial movement through the live window</h3>
            </div>
            <div className="live-indicator-row">
              {loading || !lastUpdated ? (
                <span className={`status-pill small ${dashboardTone(loading ? "Loading" : "Paused")}`}>
                  {loading ? "Loading" : "Paused"}
                </span>
              ) : (
                <span className="live-indicator" aria-label="Live" title="Live" />
              )}
              <small>
                {loading
                  ? "Refreshing live data..."
                  : lastUpdated
                  ? `Updated ${formatDate(lastUpdated)}`
                  : "Waiting for live data"}
              </small>
            </div>
          </header>

          <div className="dashboard-ref-chart-shell">
            {loading ? (
              <p className="subtle">Loading performance chart...</p>
            ) : (
              <ResponsiveContainer width="100%" height={340}>
                <ComposedChart data={trend}>
                  <defs>
                    <linearGradient id="dashboardRevenueFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ANALYTICAL_BLUE_ACCENT} stopOpacity="0.34" />
                      <stop offset="54%" stopColor={ANALYTICAL_BLUE_MID} stopOpacity="0.15" />
                      <stop offset="100%" stopColor={ANALYTICAL_BLUE_FAINT} stopOpacity="0.04" />
                    </linearGradient>
                    <linearGradient id="dashboardOrdersBarFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ANALYTICAL_BLUE_MID} />
                      <stop offset="100%" stopColor={ANALYTICAL_BLUE_DEEP} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis
                    yAxisId="money"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => formatMoney(currency, value)}
                  />
                  <YAxis yAxisId="orders" orientation="right" tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "14px",
                      color: "var(--text-primary)",
                    }}
                    formatter={(value, name) => {
                      if (name === "Orders") return [value, name];
                      if (name === "Paid Rate") return [`${Number(value || 0).toFixed(1)}%`, name];
                      return [formatMoney(currency, value), name];
                    }}
                  />
                  <Area
                    yAxisId="money"
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke={ANALYTICAL_BLUE_DEEP}
                    fill="url(#dashboardRevenueFill)"
                    strokeWidth={2.8}
                  />
                  <Bar
                    yAxisId="orders"
                    dataKey="orders"
                    name="Orders"
                    fill="url(#dashboardOrdersBarFill)"
                    radius={[10, 10, 0, 0]}
                    maxBarSize={28}
                  />
                  <Line
                    yAxisId="orders"
                    dataKey="paidRatePct"
                    name="Paid Rate"
                    stroke={ANALYTICAL_BLUE_MID}
                    strokeWidth={2.2}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>

        <aside className="dashboard-ref-side-stack">
          <article className="dashboard-ref-panel dashboard-ref-panel--list">
            <header className="dashboard-ref-panel-head">
              <div>
                <span className="dashboard-ref-panel-kicker">Top stock</span>
                <h3>Revenue leaders</h3>
              </div>
            </header>

            <div className="dashboard-ref-list">
              {topProducts.length ? (
                topProducts.slice(0, 4).map((product, index) => (
                  <DashboardProductRow
                    key={`${product?.name || product?.sku || "product"}-${index}`}
                    item={product}
                    currency={currency}
                  />
                ))
              ) : (
                <p className="subtle">No product leaderboard is available yet.</p>
              )}
            </div>
          </article>

          <article className="dashboard-ref-panel dashboard-ref-panel--list">
            <header className="dashboard-ref-panel-head">
              <div>
                <span className="dashboard-ref-panel-kicker">Inventory status</span>
                <h3>Lines needing attention</h3>
              </div>
            </header>

            <div className="dashboard-ref-list">
              {lowStock.length ? (
                lowStock.slice(0, 5).map((item, index) => (
                  <article
                    key={`${item?.sku || item?.name || "risk"}-${index}`}
                    className="dashboard-ref-alert-row"
                  >
                    <div>
                      <strong>{item?.name || item?.sku || "SKU"}</strong>
                      <small>{item?.sku || "No SKU"} / {item?.supplier || "No supplier"}</small>
                    </div>
                    <div className="dashboard-ref-alert-meta">
                      <strong>{item?.stock ?? "n/a"}</strong>
                      <span>left</span>
                    </div>
                  </article>
                ))
              ) : (
                <p className="subtle">No low-stock items are currently active.</p>
              )}
            </div>
          </article>
        </aside>
      </section>

      <section className="dashboard-ref-lower-grid">
        <article className="dashboard-ref-panel dashboard-ref-panel--table">
          <header className="dashboard-ref-panel-head">
            <div>
              <span className="dashboard-ref-panel-kicker">Recent orders</span>
              <h3>Latest commercial movement</h3>
            </div>
            <button type="button" className="btn btn-secondary btn-compact" onClick={() => navigate("/orders")}>
              Open orders
            </button>
          </header>

          <div className="dashboard-ref-table-wrap">
            {recentSales.length ? (
              <table className="table dashboard-ref-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Date</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSales.slice(0, 6).map((sale, index) => (
                    <tr key={`${sale?.id || "sale"}-${index}`}>
                      <td>{sale?.id || "No receipt id"}</td>
                      <td>{formatDate(sale?.date || sale?.createdAt)}</td>
                      <td>{sale?.customer || sale?.cashier || "Walk-in Customer"}</td>
                      <td>
                            <span className={`status-pill small ${dashboardTone(sale?.status || "Unknown")}`}>
                              {sale?.status || "Unknown"}
                            </span>
                      </td>
                      <td>{formatMoney(currency, firstNumberFrom(sale, ["total", "amount"]))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="subtle">No recent receipts were returned.</p>
            )}
          </div>
        </article>

        <div className="dashboard-ref-lower-stack">
          <article className="dashboard-ref-panel">
            <header className="dashboard-ref-panel-head">
              <div>
                <span className="dashboard-ref-panel-kicker">Decision queue</span>
                <h3>What needs action next</h3>
              </div>
            </header>

            <div className="dashboard-ref-list">
              {decisionQueue.length ? (
                decisionQueue.slice(0, 4).map((item, index) => (
                  <article
                    key={`${item?.label || item?.title || "decision"}-${index}`}
                    className="dashboard-ref-decision-row"
                  >
                    <div>
                      <strong>{item?.label || item?.title || "Decision"}</strong>
                      <small>{item?.summary || item?.note || item?.message || "No supporting note returned."}</small>
                    </div>
                    <span className={`status-pill small ${dashboardTone(item?.value || item?.tone || "live")}`}>
                      {item?.value || item?.tone || "live"}
                    </span>
                  </article>
                ))
              ) : (
                <p className="subtle">No narrative changes were returned.</p>
              )}
            </div>
          </article>

          <article className="dashboard-ref-panel">
            <header className="dashboard-ref-panel-head">
              <div>
                <span className="dashboard-ref-panel-kicker">Forecast studio</span>
                <h3>Forward revenue envelope</h3>
              </div>
            </header>

            <div className="dashboard-ref-chart-shell dashboard-ref-chart-shell--compact">
              {projectionSeries.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <ComposedChart data={projectionSeries}>
                    <defs>
                      <linearGradient id="dashboardForecastUpperFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ANALYTICAL_BLUE_MID} stopOpacity="0.24" />
                        <stop offset="100%" stopColor={ANALYTICAL_BLUE_FAINT} stopOpacity="0.02" />
                      </linearGradient>
                      <linearGradient id="dashboardForecastLowerFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ANALYTICAL_BLUE_PALE} stopOpacity="0.18" />
                        <stop offset="100%" stopColor={ANALYTICAL_BLUE_FAINT} stopOpacity="0.02" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => formatMoney(currency, value)} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "14px",
                        color: "var(--text-primary)",
                      }}
                      formatter={(value) => formatMoney(currency, value)}
                    />
                    <Area
                      type="monotone"
                      dataKey="projectedRevenueUpper"
                      stroke={ANALYTICAL_BLUE_MID}
                      fill="url(#dashboardForecastUpperFill)"
                      strokeWidth={1.4}
                    />
                    <Area
                      type="monotone"
                      dataKey="projectedRevenueLower"
                      stroke={ANALYTICAL_BLUE_SOFT}
                      fill="url(#dashboardForecastLowerFill)"
                      strokeWidth={1.4}
                    />
                    <Line
                      type="monotone"
                      dataKey="projectedRevenue"
                      stroke={ANALYTICAL_BLUE_DEEP}
                      strokeWidth={2.8}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <p className="subtle">No forecast projection is available yet.</p>
              )}
            </div>

            {mlQualityWarnings.length ? (
              <div className="dashboard-ref-note-stack">
                {mlQualityWarnings.map((warning, index) => (
                  <div key={`${warning}-${index}`} className="dashboard-ref-note">
                    {warning}
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        </div>
      </section>
    </div>
  );
}

export default Dashboard;
