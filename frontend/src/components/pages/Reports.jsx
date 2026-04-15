import { startTransition, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  FaArrowTrendUp as FiTrendingUp,
  FaBoxArchive as FiPackage,
  FaChartColumn as FiBarChart2,
  FaChartLine as FiActivity,
  FaDownload as FiDownload,
  FaShieldHalved as FiShield,
} from "react-icons/fa6";

import API from "../../api/api";
import TimeRangeSwitch from "./shared/TimeRangeSwitch";
import SoftPagination from "./shared/SoftPagination";
import {
  ANALYTICAL_BLUE_ACCENT,
  ANALYTICAL_BLUE_DEEP,
  ANALYTICAL_BLUE_FAINT,
  ANALYTICAL_BLUE_MID,
  ANALYTICAL_BLUE_SCALE,
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

const SKU_PAGE_SIZE = 8;
const CATEGORY_COLORS = ANALYTICAL_BLUE_SCALE;

function Reports({ settings }) {
  const navigate = useNavigate();
  const [range, setRange] = useState("monthly");
  const [data, setData] = useState({});
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshNonce, _setRefreshNonce] = useState(0);
  const [skuPage, setSkuPage] = useState(1);
  const currency = settings?.currency || "CAD";
  const normalizePercent = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return numeric <= 1 ? numeric * 100 : numeric;
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const response = await API.get(`/reports?range=${range}`);
        if (cancelled) return;
        startTransition(() => {
          setData(getResponseData(response) || {});
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) setError(requestError?.message || "Could not load reports.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [range, refreshNonce]);

  const summary = useMemo(() => toObject(data?.summary), [data]);
  const executiveSummary = useMemo(() => toObject(data?.executiveSummary), [data]);
  const trendUpdatedAt = useMemo(() => {
    if (data?.generatedAt) return data.generatedAt;
    const source = firstArrayFrom(data, ["trend", "statusTrend"]);
    const latest = [...source]
      .reverse()
      .find((entry) => entry?.updatedAt || entry?.date || entry?.periodEnd || entry?.timestamp);
    return latest?.updatedAt || latest?.date || latest?.periodEnd || latest?.timestamp || "";
  }, [data]);
  const trend = useMemo(() => {
    const revenueTrend = firstArrayFrom(data, ["trend"]);
    const statusTrend = firstArrayFrom(data, ["statusTrend"]);
    const statusMap = new Map(
      statusTrend.map((entry, index) => [
        String(entry?.label || entry?.date || entry?.period || `P-${index + 1}`),
        entry,
      ])
    );
    const source = revenueTrend.length ? revenueTrend : statusTrend;

    return source.map((entry, index) => {
      const label = String(entry?.label || entry?.date || entry?.period || `P-${index + 1}`);
      const statusEntry = statusMap.get(label) || statusTrend[index] || {};
      const paidRateRaw = firstNumberFrom(statusEntry, ["paidRate", "collectionRate"]);

      return {
        label,
        revenue: firstNumberFrom(entry, ["revenue", "capturedRevenue", "totalRevenue", "paidRevenue"]),
        paidRate: normalizePercent(paidRateRaw),
      };
    });
  }, [data]);
  const statusTrend = useMemo(() => {
    const source = firstArrayFrom(data, ["statusBreakdown", "orderStatusBreakdown", "statusTrend", "ordersOverview"]);
    return source.map((entry, index) => ({
      label: String(entry?.label || entry?.status || entry?.name || `Status ${index + 1}`),
      value: firstNumberFrom(entry, ["revenue", "value", "amount", "paidRevenue"]),
    }));
  }, [data]);
  const topProducts = useMemo(() => firstArrayFrom(data, ["topProducts"]).slice(0, 5), [data]);
  const categoryBreakdown = useMemo(() => {
    const source = firstArrayFrom(data, ["categoryBreakdown"]).slice(0, 5);
    const total = source.reduce((sum, item) => sum + firstNumberFrom(item, ["value", "revenue"]), 0);
    return source.map((item) => ({
      name: String(item?.name || item?.category || "Uncategorized"),
      value: firstNumberFrom(item, ["value", "revenue"]),
      share: total > 0 ? (firstNumberFrom(item, ["value", "revenue"]) / total) * 100 : 0,
    }));
  }, [data]);
  const mlForecast = useMemo(() => toObject(data?.mlForecast), [data]);
  const mlPeriods = useMemo(() => firstArrayFrom(mlForecast, ["periods"]).slice(0, 6), [mlForecast]);
  const mlRecommendations = useMemo(() => firstArrayFrom(mlForecast, ["restockRecommendations"]).slice(0, 4), [mlForecast]);
  const mlSupplierSignals = useMemo(() => firstArrayFrom(mlForecast, ["supplierSignals"]).slice(0, 4), [mlForecast]);
  const mlSkuForecasts = useMemo(() => firstArrayFrom(mlForecast, ["skuForecasts"]).slice(0, 24), [mlForecast]);
  const mlPortfolioSummary = useMemo(() => toObject(mlForecast?.portfolioSummary), [mlForecast]);
  const mlFoundation = useMemo(() => toObject(mlForecast?.dataFoundation), [mlForecast]);
  const mlFoundationCoverage = useMemo(() => toObject(mlFoundation?.coverage), [mlFoundation]);
  const recentRevenueRows = useMemo(() => trend.slice(-3).reverse(), [trend]);
  const archiveRows = useMemo(
    () =>
      (mlRecommendations.length ? mlRecommendations : mlSupplierSignals).slice(0, 5).map((item, index) => ({
        id: item?.sku || item?.supplier || `archive-${index + 1}`,
        name: item?.name || item?.supplier || item?.sku || "Report signal",
        detail: item?.whyNow || item?.reason || item?.note || "Operational note",
        value:
          item?.orderSpend !== undefined
            ? formatMoney(currency, firstNumberFrom(item, ["orderSpend"]))
            : `${(firstNumberFrom(item, ["maxStockoutProbability"]) * 100).toFixed(1)}%`,
      })),
    [currency, mlRecommendations, mlSupplierSignals]
  );

  useEffect(() => {
    setSkuPage(1);
  }, [range, mlSkuForecasts.length]);

  const forecastSeries = useMemo(
    () =>
      mlPeriods.map((entry, index) => ({
        label: String(entry?.label || `F-${index + 1}`),
        projectedRevenue: firstNumberFrom(entry, ["projectedRevenue"]),
      })),
    [mlPeriods]
  );

  const summaryCards = [
    {
      label: "Total Sales",
      value: formatMoney(currency, firstNumberFrom(summary, ["revenue", "capturedRevenue", "totalRevenue"])),
      note: `${formatPercent(firstNumberFrom(summary, ["paidRate", "collectionRate"]))} paid rate`,
      icon: FiBarChart2,
    },
    {
      label: "Revenue Forecast",
      value: formatMoney(currency, firstNumberFrom(forecastSeries[0], ["projectedRevenue"])),
      note: "Forward-looking revenue envelope",
      icon: FiTrendingUp,
    },
    {
      label: "Profit To Date",
      value: formatMoney(currency, firstNumberFrom(summary, ["profit"])),
      note: `${formatPercent(firstNumberFrom(summary, ["profitCoverageRate"]))} coverage`,
      icon: FiActivity,
    },
    {
      label: "Total Orders",
      value: `${firstNumberFrom(summary, ["orderCount", "orders", "totalOrders"])}`,
      note: `${firstNumberFrom(mlPortfolioSummary, ["deferredSkuCount"])} deferred SKUs`,
      icon: FiPackage,
    },
  ];

  const skuTotalPages = Math.max(1, Math.ceil(mlSkuForecasts.length / SKU_PAGE_SIZE));
  const activeSkuPage = Math.min(skuPage, skuTotalPages);
  const pagedSkuForecasts = mlSkuForecasts.slice((activeSkuPage - 1) * SKU_PAGE_SIZE, activeSkuPage * SKU_PAGE_SIZE);

  const exportCsv = async () => {
    if (exporting) return;
    try {
      setExporting(true);
      setError("");
      const response = await API.get("/reports/export", { responseType: "blob" });
      const blob = new Blob([response.data], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `afrospice-reports-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setNotice("Report export downloaded.");
    } catch (exportError) {
      setError(exportError?.message || "Could not export CSV.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="page-container reports-ref-page">
      {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}
      {notice ? <div className="info-banner">{notice}</div> : null}

      <section className="reference-page-heading reports-reference-heading">
        <div className="reference-page-heading-copy">
          <span className="reference-page-kicker">Reporting</span>
          <h1>Reports</h1>
          <p>
            {executiveSummary?.headline ||
              "Run insightful reports backed by live metrics and a softer, cleaner command surface."}
          </p>
        </div>
      </section>

      <section className="reports-reference-toolbar">
        <div className="reports-reference-toolbar-copy">
          <span className="reference-page-kicker">Reporting window</span>
          <strong>Switch the live analysis range with the same cleaner control language used in Orders.</strong>
        </div>
        <div className="orders-reference-toolbar-actions">
          <TimeRangeSwitch value={range} onChange={setRange} ariaLabel="Reporting range" className="range-switch--toolbar" />
          <button type="button" className="btn btn-primary" onClick={exportCsv} disabled={exporting}>
            <FiDownload />
            {exporting ? "Exporting..." : "Create Report"}
          </button>
        </div>
      </section>

      <section className="soft-summary-grid soft-summary-grid--four">
        {summaryCards.map((card) => (
          <article key={card.label} className="soft-summary-card">
            <div className="soft-summary-icon">{card.icon ? <card.icon /> : null}</div>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>

      <section className="soft-main-grid soft-main-grid--reports reports-reference-main">
        <article className="soft-panel soft-panel--chart reports-breakdown-panel">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Revenue breakdown</span>
              <h2>Revenue movement across the current window</h2>
              <p>{executiveSummary?.summary || "Track live performance in one clearer analytical surface."}</p>
            </div>
            <div className="live-indicator-row">
              {loading || !trendUpdatedAt ? (
                <span className="status-pill small neutral">{loading ? "Loading" : "Paused"}</span>
              ) : (
                <span className="live-indicator" aria-label="Live trend" title="Live trend" />
              )}
              <small>{trendUpdatedAt ? `Updated ${formatDate(trendUpdatedAt)}` : "Waiting for live data"}</small>
            </div>
          </header>
          <div className="soft-chart-shell">
            {loading ? (
              <p className="subtle">Loading revenue trend...</p>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <AreaChart data={trend}>
                  <defs>
                    <linearGradient id="reportsAreaFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ANALYTICAL_BLUE_ACCENT} stopOpacity="0.34" />
                      <stop offset="56%" stopColor={ANALYTICAL_BLUE_MID} stopOpacity="0.14" />
                      <stop offset="100%" stopColor={ANALYTICAL_BLUE_FAINT} stopOpacity="0.04" />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} tickFormatter={(value) => formatMoney(currency, value)} />
                  <Tooltip
                    contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px" }}
                    formatter={(value) => [formatMoney(currency, value), "Revenue"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke={ANALYTICAL_BLUE_DEEP}
                    fill="url(#reportsAreaFill)"
                    strokeWidth={2.8}
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
          <div className="reports-breakdown-rows">
            {recentRevenueRows.length ? (
              recentRevenueRows.map((row) => (
                <article key={row.label} className="reports-breakdown-row">
                  <div>
                    <strong>{row.label}</strong>
                    <small>{formatPercent(row.paidRate)} paid rate</small>
                  </div>
                  <span>{formatMoney(currency, row.revenue)}</span>
                </article>
              ))
            ) : (
              <p className="subtle">No revenue checkpoints are available yet.</p>
            )}
          </div>
        </article>

        <aside className="soft-side-stack">
          <article className="soft-panel soft-panel--compact reports-side-card">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Top products by revenue</span>
                <h3>Top Products By Revenue</h3>
              </div>
            </header>
            <div className="soft-list">
              {topProducts.length ? (
                topProducts.map((item) => {
                  const visual = getProductVisual(item);
                  return (
                    <article key={item?.name || item?.sku} className="soft-list-row soft-list-row--media">
                      <div className={`product-thumb product-thumb--${visual.tone}`}>
                        <img src={visual.image} alt={visual.alt} />
                      </div>
                      <div>
                        <strong>{item?.name || item?.sku || "Product"}</strong>
                        <small>{item?.category || item?.supplier || "Live catalog item"}</small>
                      </div>
                      <div className="soft-inline-value">
                        <strong>{formatMoney(currency, firstNumberFrom(item, ["revenue", "value", "sales"]))}</strong>
                      </div>
                    </article>
                  );
                })
              ) : (
                <p className="subtle">No product leaderboard returned yet.</p>
              )}
            </div>
          </article>

          <article className="soft-panel soft-panel--compact reports-side-card">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Model posture</span>
                <h3>Protected revenue and coverage</h3>
              </div>
            </header>
            <div className="reports-side-metrics">
              <article className="reports-side-metric">
                <span>Protected revenue</span>
                <strong>{formatMoney(currency, firstNumberFrom(mlPortfolioSummary, ["protectedRevenue"]))}</strong>
                <small>{firstNumberFrom(mlPortfolioSummary, ["deferredSkuCount"])} deferred SKUs</small>
              </article>
              <article className="reports-side-metric">
                <span>Coverage</span>
                <strong>{formatPercent(firstNumberFrom(summary, ["profitCoverageRate"]))}</strong>
                <small>Profit coverage across the reporting window.</small>
              </article>
              <article className="reports-side-metric reports-side-metric--action">
                <button type="button" className="btn btn-secondary btn-full" onClick={() => navigate("/orders")}>
                  <FiShield />
                  Open Order Operations
                </button>
              </article>
            </div>
          </article>

          <article className="soft-panel soft-panel--compact reports-side-card">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Model queue</span>
                <h3>Next recommended moves</h3>
              </div>
            </header>
            <div className="soft-list">
              {mlRecommendations.length ? (
                mlRecommendations.slice(0, 3).map((item, index) => (
                  <article key={`${item?.sku || item?.name || "recommendation"}-${index}`} className="soft-list-row">
                    <div>
                      <strong>{item?.name || item?.sku || "Recommendation"}</strong>
                      <small>{item?.whyNow || item?.reason || "No recommendation note returned."}</small>
                    </div>
                    <span className="status-pill small neutral">{formatMoney(currency, firstNumberFrom(item, ["orderSpend"]))}</span>
                  </article>
                ))
              ) : (
                <p className="subtle">No replenishment queue is available yet.</p>
              )}
            </div>
          </article>
        </aside>
      </section>

      <section className="soft-section-grid soft-section-grid--two reports-reference-secondary">
        <article className="soft-panel">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Orders overview</span>
              <h3>How order value is settling</h3>
            </div>
          </header>
          <div className="soft-chart-shell soft-chart-shell--short">
            {statusTrend.length ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={statusTrend}>
                  <defs>
                    <linearGradient id="reportsBarsGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ANALYTICAL_BLUE_MID} />
                      <stop offset="100%" stopColor={ANALYTICAL_BLUE_DEEP} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px" }} formatter={(value) => [formatMoney(currency, value), "Value"]} />
                  <Bar dataKey="value" fill="url(#reportsBarsGradient)" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="subtle">No order overview is available yet.</p>
            )}
          </div>
        </article>

        <article className="soft-panel reports-mix-panel">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Category mix</span>
              <h3>Where revenue is concentrated</h3>
            </div>
          </header>
          <div className="reports-mix-surface">
            <div className="soft-chart-shell soft-chart-shell--short">
              {categoryBreakdown.length ? (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={categoryBreakdown} dataKey="share" nameKey="name" innerRadius={58} outerRadius={88} paddingAngle={3}>
                      {categoryBreakdown.map((entry, index) => (
                        <Cell key={`${entry.name}-${index}`} fill={CATEGORY_COLORS[index % CATEGORY_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`${Number(value || 0).toFixed(1)}%`, "Share"]} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="subtle">No category mix is available yet.</p>
              )}
            </div>
            <div className="soft-list reports-mix-list">
              {categoryBreakdown.map((item) => (
                <article key={item.name} className="soft-list-row">
                  <div>
                    <strong>{item.name}</strong>
                    <small>{formatMoney(currency, item.value)}</small>
                  </div>
                  <span className="status-pill small neutral">{item.share.toFixed(1)}%</span>
                </article>
              ))}
            </div>
          </div>
        </article>
      </section>

      <section className="soft-panel soft-table-card reports-planning-card">
        <header className="soft-panel-header">
          <div>
            <span className="reference-page-kicker">Planning table</span>
            <h2>SKU forecast and planning board</h2>
            <p>Use the live model outputs as a cleaner decision table instead of scrolling through raw payloads.</p>
          </div>
          <span className="status-pill small neutral">{mlSkuForecasts.length} tracked SKUs</span>
        </header>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Product</th>
                <th>Policy</th>
                <th>Service Level</th>
                <th>Stockout Risk</th>
                <th>Order Spend</th>
                <th>Next Action</th>
              </tr>
            </thead>
            <tbody>
              {pagedSkuForecasts.length ? (
                pagedSkuForecasts.map((item, index) => (
                  <tr key={`${item?.sku || item?.name || "sku"}-${index}`}>
                    <td>
                      <strong>{item?.name || item?.sku || "SKU"}</strong>
                      <div>{item?.sku || item?.supplier || "Forecast item"}</div>
                    </td>
                    <td>{item?.stockPolicyClass || item?.cashPriorityTier || "watch"}</td>
                    <td>{`${firstNumberFrom(item, ["serviceLevelTargetPct"]).toFixed(1)}%`}</td>
                    <td>{`${(firstNumberFrom(item, ["stockoutProbability"]) * 100).toFixed(1)}%`}</td>
                    <td>{formatMoney(currency, firstNumberFrom(item, ["orderSpend"]))}</td>
                    <td>{item?.nextAction || item?.whyNow || "Review"}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="empty-cell">
                    No forecast purchase table is available yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <SoftPagination currentPage={activeSkuPage} totalPages={skuTotalPages} onChange={setSkuPage} />
      </section>

      <section className="soft-section-grid soft-section-grid--two reports-reference-tertiary">
        <article className="soft-panel">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Supplier pressure</span>
              <h3>Drag and stockout risk</h3>
            </div>
          </header>
          <div className="soft-list">
            {mlSupplierSignals.length ? (
              mlSupplierSignals.map((item, index) => (
                <article key={`${item?.supplier || "supplier"}-${index}`} className="soft-list-row">
                  <div>
                    <strong>{item?.supplier || "Supplier"}</strong>
                    <small>{firstNumberFrom(item, ["weightedRiskScore"]).toFixed(1)} weighted risk</small>
                  </div>
                  <span className="status-pill small neutral">
                    {(firstNumberFrom(item, ["maxStockoutProbability"]) * 100).toFixed(1)}%
                  </span>
                </article>
              ))
            ) : (
              <p className="subtle">No supplier pressure is active right now.</p>
            )}
          </div>
        </article>

        <article className="soft-panel">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Signals archive</span>
              <h3>Archive and quick-read notes</h3>
            </div>
          </header>
          <div className="reports-archive-grid">
            <div className="soft-list">
              {archiveRows.length ? (
                archiveRows.map((row) => (
                  <article key={row.id} className="soft-list-row">
                    <div>
                      <strong>{row.name}</strong>
                      <small>{row.detail}</small>
                    </div>
                    <span className="status-pill small neutral">{row.value}</span>
                  </article>
                ))
              ) : (
                <p className="subtle">No archived signals are available yet.</p>
              )}
            </div>
            <div className="soft-key-value-list">
              {[
                ["Movement", firstNumberFrom(mlFoundationCoverage, ["movementCoverageRate"])],
                ["Lead Time", firstNumberFrom(mlFoundationCoverage, ["leadTimeCoverageRate"])],
                ["Cycle Count", firstNumberFrom(mlFoundationCoverage, ["cycleCountCoverageRate"])],
                ["Named Customer", firstNumberFrom(mlFoundationCoverage, ["namedCustomerRate"])],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{Number(value || 0).toFixed(1)}%</strong>
                </div>
              ))}
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

export default Reports;
