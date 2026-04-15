import { startTransition, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FaArrowTrendUp as FiTrendingUp,
  FaChartLine as FiActivity,
  FaClock as FiClock,
  FaDownload as FiDownload,
  FaMagnifyingGlass as FiSearch,
  FaPlus as FiPlus,
  FaShieldHalved as FiShield,
} from "react-icons/fa6";

import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import TimeRangeSwitch from "./shared/TimeRangeSwitch";
import SoftPagination from "./shared/SoftPagination";
import {
  firstNumberFrom,
  formatDate,
  formatMoney,
  formatPercent,
  getResponseData,
  toObject,
} from "./shared/dataHelpers";

const LEDGER_PAGE_SIZE = 10;

function normalizeSales(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.sales)) return payload.sales;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function matchesOrderQuery(order, rawQuery) {
  const query = String(rawQuery || "").trim().toLowerCase();
  if (!query) return true;

  return [order?.id, order?.cashier, order?.customer, order?.channel, order?.paymentMethod, order?.status]
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function getStatusTone(status = "") {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("paid") || normalized.includes("fulfilled")) return "success";
  if (normalized.includes("pending")) return "warning";
  if (normalized.includes("declined") || normalized.includes("cancel")) return "danger";
  if (normalized.includes("refund")) return "neutral";
  return "neutral";
}

function getFulfillmentPercent(status = "") {
  const normalized = String(status || "").toLowerCase();
  if (normalized.includes("paid") || normalized.includes("fulfilled")) return 100;
  if (normalized.includes("pending")) return 55;
  if (normalized.includes("refund")) return 72;
  if (normalized.includes("declined") || normalized.includes("cancel")) return 24;
  return 40;
}

function getPaymentLabel(order = {}) {
  const normalized = String(order?.status || "").toLowerCase();
  if (normalized.includes("paid")) return "Paid";
  if (normalized.includes("refund")) return "Refunded";
  if (normalized.includes("declined")) return "Declined";
  return order?.paymentMethod || "Pending";
}

function getStatusOptions(currentStatus) {
  const normalized = String(currentStatus || "Pending").trim();
  const transitions = {
    Pending: ["Pending", "Paid", "Declined"],
    Paid: ["Paid", "Refunded"],
    Declined: ["Declined"],
    Refunded: ["Refunded"],
  };

  return transitions[normalized] || [normalized];
}

function downloadCsv(rows = [], currency = "CAD") {
  const header = ["Order ID", "Date", "Customer", "Cashier", "Status", "Payment", "Total"];
  const lines = rows.map((row) =>
    [
      row?.id || "",
      formatDate(row?.date || row?.createdAt),
      row?.customer || "Walk-in",
      row?.cashier || "",
      row?.status || "",
      getPaymentLabel(row),
      formatMoney(currency, firstNumberFrom(row, ["total", "amount"])),
    ]
      .map((field) => `"${String(field || "").replace(/"/g, '""')}"`)
      .join(",")
  );

  const csv = [header.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `afrospice-orders-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

function Orders({ settings }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [range, setRange] = useState("monthly");
  const [analytics, setAnalytics] = useState({});
  const [orders, setOrders] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatingOrderId, setUpdatingOrderId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [ledgerPage, setLedgerPage] = useState(1);

  const currency = settings?.currency || "CAD";
  const assistantActionLabel = location.state?.assistantActionLabel || "";
  const assistantActionNote = location.state?.assistantActionNote || "";

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const [analyticsResponse, salesResponse] = await Promise.all([
          API.get(`/reports/orders?range=${range}`),
          API.get("/sales"),
        ]);

        if (cancelled) return;

        startTransition(() => {
          setAnalytics(getResponseData(analyticsResponse) || {});
          setOrders(normalizeSales(getResponseData(salesResponse)));
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError?.message || "Could not load order analytics.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [range, refreshNonce]);

  useEffect(() => {
    const routeState = location.state || {};
    if (Object.prototype.hasOwnProperty.call(routeState, "prefillOrderQuery")) {
      setQuery(String(routeState.prefillOrderQuery || ""));
    }

    if (routeState.ordersFocus) {
      window.requestAnimationFrame(() => {
        const target = document.getElementById("orders-ledger");
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }, [location.key, location.state]);

  useEffect(() => {
    setLedgerPage(1);
  }, [query, range, orders.length]);

  const summary = useMemo(() => toObject(analytics?.summary), [analytics]);
  const filteredOrders = useMemo(() => orders.filter((order) => matchesOrderQuery(order, query)), [orders, query]);
  const pendingOrders = filteredOrders.filter((order) => String(order?.status || "").toLowerCase().includes("pending"));
  const paidOrders = filteredOrders.filter((order) => String(order?.status || "").toLowerCase().includes("paid"));
  const ledgerTotalPages = Math.max(1, Math.ceil(filteredOrders.length / LEDGER_PAGE_SIZE));
  const activeLedgerPage = Math.min(ledgerPage, ledgerTotalPages);
  const ledgerRows = filteredOrders.slice(
    (activeLedgerPage - 1) * LEDGER_PAGE_SIZE,
    activeLedgerPage * LEDGER_PAGE_SIZE
  );

  const summaryCards = [
    {
      label: "Total Orders",
      value: `${firstNumberFrom(summary, ["totalOrders", "orders", "orderCount"]) || filteredOrders.length}`,
      note: `${filteredOrders.length} visible in current view`,
      icon: FiActivity,
    },
    {
      label: "Revenue",
      value: formatMoney(currency, firstNumberFrom(summary, ["paidRevenue", "capturedRevenue", "revenue", "totalRevenue"])),
      note: `${formatPercent(firstNumberFrom(summary, ["paidRate", "collectionRate"]))} collection quality`,
      icon: FiTrendingUp,
    },
    {
      label: "Pending Orders",
      value: `${firstNumberFrom(summary, ["pendingOrders"]) || pendingOrders.length}`,
      note: `${formatMoney(currency, firstNumberFrom(summary, ["pendingRevenue"]))} pending value`,
      icon: FiClock,
    },
  ];

  const updateOrderStatus = async (order, status) => {
    if (!order?.id || !status || updatingOrderId || String(order?.status || "") === status) return;

    try {
      setUpdatingOrderId(String(order.id));
      setError("");
      setNotice("");
      await API.patch(`/sales/${order.id}/status`, { status });
      setNotice(`Order ${order.id} updated to ${status}.`);
      setRefreshNonce((value) => value + 1);
    } catch (submitError) {
      setError(submitError?.message || "Could not update order status.");
    } finally {
      setUpdatingOrderId("");
    }
  };

  return (
    <div className="page-container orders-reference-page">
      <AssistantActionBanner label={assistantActionLabel} note={assistantActionNote} />
      {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}
      {notice ? <div className="info-banner">{notice}</div> : null}

      <section className="reference-page-heading orders-reference-heading">
        <div className="reference-page-heading-copy">
          <span className="reference-page-kicker">Orders</span>
          <h1>Orders</h1>
          <p>Manage customer orders, statuses, and fulfillment progress in one clean control surface.</p>
        </div>
      </section>

      <section className="orders-reference-toolbar">
        <div className="reference-inline-search orders-reference-search">
          <FiSearch />
          <input
            className="input"
            type="text"
            placeholder="Search by order ID, customer, cashier, channel, or payment"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <div className="orders-reference-toolbar-actions">
          <TimeRangeSwitch value={range} onChange={setRange} ariaLabel="Order reporting range" className="range-switch--toolbar" />
          <button type="button" className="btn btn-primary" onClick={() => downloadCsv(filteredOrders, currency)}>
            <FiDownload />
            Export CSV
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => navigate("/orders/new")}>
            <FiPlus />
            New Order
          </button>
        </div>
      </section>

      <section className="orders-summary-strip">
        {summaryCards.map((card) => (
          <article key={card.label} className="orders-summary-card">
            <div className="reference-stat-head">
              <div className="reference-stat-icon">{card.icon ? <card.icon /> : null}</div>
            </div>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}

        <article className="orders-summary-card orders-summary-card--action">
          <div className="reference-stat-head">
            <div className="reference-stat-icon">
              <FiShield />
            </div>
          </div>
          <span>Settlement posture</span>
          <strong>{paidOrders.length} paid</strong>
          <small>{pendingOrders.length} pending review in the current filtered view.</small>
          <button type="button" className="btn btn-secondary btn-compact" onClick={() => downloadCsv(filteredOrders, currency)}>
            Export CSV
          </button>
        </article>
      </section>

      <section id="orders-ledger" className="soft-panel soft-table-card orders-reference-table-card">
        <header className="soft-panel-header">
          <div>
            <span className="reference-page-kicker">Order History</span>
            <h2>Live transaction ledger</h2>
          </div>
          <div className="orders-table-head-actions">
            <span className="users-directory-count">{filteredOrders.length} items</span>
          </div>
        </header>

        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>Order ID</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Total</th>
                <th>Fulfillment</th>
                <th>Payment</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="empty-cell">
                    Loading live orders...
                  </td>
                </tr>
              ) : ledgerRows.length ? (
                ledgerRows.map((order) => {
                  const statusTone = getStatusTone(order?.status);
                  const fulfillment = getFulfillmentPercent(order?.status);
                  const paymentLabel = getPaymentLabel(order);

                  return (
                    <tr key={order?.id}>
                      <td>
                        <input type="checkbox" aria-label={`Select ${order?.id || "order"}`} />
                      </td>
                      <td>{order?.id || "n/a"}</td>
                      <td>{formatDate(order?.date || order?.createdAt)}</td>
                      <td>{order?.customer || "Walk-in"}</td>
                      <td>
                        <span className={`status-pill small ${statusTone}`}>{order?.status || "Unknown"}</span>
                      </td>
                      <td>{formatMoney(currency, firstNumberFrom(order, ["total", "amount"]))}</td>
                      <td>
                        <div className="orders-fulfillment-cell">
                          <div className="orders-fulfillment-track">
                            <span className="orders-fulfillment-bar" style={{ width: `${fulfillment}%` }} />
                          </div>
                          <small>{fulfillment}%</small>
                        </div>
                      </td>
                      <td>
                        <span className={`status-pill small ${getStatusTone(paymentLabel)}`}>{paymentLabel}</span>
                      </td>
                      <td>
                        <select
                          className="input soft-table-select"
                          value={order?.status || "Pending"}
                          onChange={(event) => updateOrderStatus(order, event.target.value)}
                          disabled={updatingOrderId === String(order?.id)}
                        >
                          {getStatusOptions(order?.status).map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={9} className="empty-cell">
                    {query ? "No orders matched the current search." : "No order records returned."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <SoftPagination currentPage={activeLedgerPage} totalPages={ledgerTotalPages} onChange={setLedgerPage} />
      </section>
    </div>
  );
}

export default Orders;
