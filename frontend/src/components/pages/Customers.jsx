import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  FaArrowTrendUp as FiTrendingUp,
  FaDollarSign as FiDollarSign,
  FaMagnifyingGlass as FiSearch,
  FaPercent as FiPercent,
  FaPlus as FiPlus,
  FaStar as FiStar,
  FaUserCheck as FiUserCheck,
  FaUsers as FiUsers,
} from "react-icons/fa6";

import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import TimeRangeSwitch from "./shared/TimeRangeSwitch";
import SoftPagination from "./shared/SoftPagination";
import { ANALYTICAL_BLUE_ACCENT, ANALYTICAL_BLUE_DEEP, ANALYTICAL_BLUE_FAINT, ANALYTICAL_BLUE_MID } from "./shared/chartTheme";
import {
  firstArrayFrom,
  firstNumberFrom,
  formatDate,
  formatMoney,
  getResponseData,
  toArray,
  toObject,
} from "./shared/dataHelpers";
import { getIdentityInitials, getIdentityTone } from "./shared/identityAvatar";

const DIRECTORY_PAGE_SIZE = 8;

function sortCustomers(items = []) {
  return [...items].sort((left, right) => {
    const walkInRank = Number(Boolean(left?.isWalkIn)) - Number(Boolean(right?.isWalkIn));
    if (walkInRank !== 0) return walkInRank;
    return String(left?.name || "").localeCompare(String(right?.name || ""));
  });
}

function matchesQuickFilter(customer, filter) {
  if (!filter || filter === "all") return true;
  if (filter === "eligible") return Boolean(customer?.discountEligible);
  if (filter === "vip") return String(customer?.loyaltyTier || "").toLowerCase() === "vip";
  if (filter === "capture") {
    return !customer?.isWalkIn && !customer?.contactCoverage?.hasEmail && !customer?.contactCoverage?.hasPhone;
  }
  if (filter === "cooling") return ["warning", "danger"].includes(String(customer?.customerStatusTone || ""));
  return true;
}

function customerRecordSearch(customer = {}, query = "") {
  if (!query) return true;
  const term = query.toLowerCase();
  return [
    customer?.name,
    customer?.email,
    customer?.phone,
    customer?.customerNumber,
    customer?.loyaltyNumber,
    customer?.loyaltyTier,
    customer?.customerStatus,
    customer?.notes,
  ]
    .join(" ")
    .toLowerCase()
    .includes(term);
}

function Customers({ settings }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [range, setRange] = useState("monthly");
  const [analyticsData, setAnalyticsData] = useState({});
  const [customers, setCustomers] = useState([]);
  const [query, setQuery] = useState("");
  const [quickFilter, setQuickFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refreshNonce, _setRefreshNonce] = useState(0);
  const [directoryPage, setDirectoryPage] = useState(1);

  const currency = settings?.currency || "CAD";
  const assistantActionLabel = location.state?.assistantActionLabel || "";
  const assistantActionNote = location.state?.assistantActionNote || "";

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const [analyticsResponse, customersResponse] = await Promise.all([
          API.get(`/reports/customers?range=${range}`),
          API.get("/customers"),
        ]);
        if (cancelled) return;

        setAnalyticsData(getResponseData(analyticsResponse) || {});
        setCustomers(sortCustomers(toArray(getResponseData(customersResponse))));
        setError("");
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError?.message || "Could not load customer data.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [range, refreshNonce]);

  useEffect(() => {
    setDirectoryPage(1);
  }, [query, quickFilter, customers.length, range]);

  const summary = useMemo(() => toObject(analyticsData?.summary), [analyticsData]);
  const trend = useMemo(() => firstArrayFrom(analyticsData, ["trend"]), [analyticsData]);
  const executiveSummary = useMemo(() => toObject(analyticsData?.executiveSummary), [analyticsData]);

  const namedCustomers = useMemo(() => customers.filter((customer) => !customer?.isWalkIn), [customers]);
  const registeredCustomers = useMemo(
    () => namedCustomers.filter((customer) => customer?.contactCoverage?.hasEmail || customer?.contactCoverage?.hasPhone),
    [namedCustomers]
  );
  const discountEligibleCustomers = useMemo(
    () => namedCustomers.filter((customer) => customer?.discountEligible),
    [namedCustomers]
  );
  const vipCustomers = useMemo(
    () => namedCustomers.filter((customer) => String(customer?.loyaltyTier || "").toLowerCase() === "vip"),
    [namedCustomers]
  );
  const captureQueue = useMemo(
    () => namedCustomers.filter((customer) => !customer?.contactCoverage?.hasEmail && !customer?.contactCoverage?.hasPhone),
    [namedCustomers]
  );
  const coolingCustomers = useMemo(
    () => namedCustomers.filter((customer) => ["warning", "danger"].includes(String(customer?.customerStatusTone || ""))),
    [namedCustomers]
  );

  const filteredCustomers = useMemo(
    () =>
      namedCustomers.filter(
        (customer) => matchesQuickFilter(customer, quickFilter) && customerRecordSearch(customer, String(query || "").trim())
      ),
    [namedCustomers, quickFilter, query]
  );

  const directoryTotalPages = Math.max(1, Math.ceil(filteredCustomers.length / DIRECTORY_PAGE_SIZE));
  const activeDirectoryPage = Math.min(directoryPage, directoryTotalPages);
  const directoryRows = filteredCustomers.slice(
    (activeDirectoryPage - 1) * DIRECTORY_PAGE_SIZE,
    activeDirectoryPage * DIRECTORY_PAGE_SIZE
  );

  const trendSeries = useMemo(
    () =>
      trend.map((entry, index) => ({
        label: String(entry?.label || entry?.date || entry?.period || `P-${index + 1}`),
        revenue: firstNumberFrom(entry, ["revenue", "value"]),
      })),
    [trend]
  );

  const summaryCards = [
    {
      label: "Named Profiles",
      value: `${namedCustomers.length}`,
      note: `${customers.filter((customer) => customer?.isWalkIn).length} system walk-in profile`,
      icon: FiUsers,
    },
    {
      label: "Registered Members",
      value: `${registeredCustomers.length}`,
      note: `${captureQueue.length} records still need phone or email`,
      icon: FiUserCheck,
    },
    {
      label: "Discount Ready",
      value: `${discountEligibleCustomers.length}`,
      note: `${vipCustomers.length} VIP accounts on premium pricing`,
      icon: FiPercent,
    },
    {
      label: "Named Revenue",
      value: formatMoney(currency, firstNumberFrom(summary, ["namedRevenue", "revenue", "totalRevenue"])),
      note: executiveSummary?.headline || "Named demand and retention value across the current reporting window.",
      icon: FiDollarSign,
    },
  ];

  const operatingCards = [
    {
      title: "Member pricing live",
      body: `${discountEligibleCustomers.length} customer profiles can receive automatic named-customer discounts.`,
      meta: `${settings?.defaultCustomerDiscountPct || 5}% member | ${settings?.vipCustomerDiscountPct || 10}% VIP`,
      action: "Review eligible",
      onClick: () => setQuickFilter("eligible"),
      icon: FiPercent,
    },
    {
      title: "VIP accounts",
      body: vipCustomers[0]?.name || "No VIP account has crossed the current threshold yet.",
      meta: `${vipCustomers.length} profiles qualify for higher-priority treatment`,
      action: "See VIPs",
      onClick: () => setQuickFilter("vip"),
      icon: FiStar,
    },
    {
      title: "Capture queue",
      body: captureQueue[0]?.name || "All named customers already have contact coverage.",
      meta: `${captureQueue.length} profiles still need a phone or email before pricing can activate`,
      action: "Fix capture",
      onClick: () => setQuickFilter("capture"),
      icon: FiUsers,
    },
    {
      title: "Cooling accounts",
      body: coolingCustomers[0]?.name || "No customer record is cooling right now.",
      meta: `${coolingCustomers.length} accounts need follow-up before demand slips`,
      action: "Open watch",
      onClick: () => setQuickFilter("cooling"),
      icon: FiTrendingUp,
    },
  ];

  const openOrdersForCustomer = (customerName) => {
    const nextCustomer = String(customerName || "").trim();
    if (!nextCustomer) return;

    navigate("/orders", {
      state: {
        assistantActionLabel: `Orders for ${nextCustomer}`,
        assistantActionNote: `The order ledger is filtered to recent tickets for ${nextCustomer}.`,
        prefillOrderQuery: nextCustomer,
        ordersFocus: "orders-ledger",
      },
    });
  };

  const startPosForCustomer = (customer) => {
    const nextCustomer = String(customer?.name || customer || "").trim();
    if (!nextCustomer) return;

    navigate("/terminal", {
      state: {
        assistantActionLabel: `Checkout for ${nextCustomer}`,
        assistantActionNote: `${nextCustomer} is prefilled in the POS so staff can apply named-customer pricing and track the sale cleanly.`,
        prefillCustomer: nextCustomer,
        prefillCustomerId: customer?.id || null,
        openAdvancedCheckout: true,
      },
    });
  };

  return (
    <div className="page-container customers-ref-page customer-roster-page">
      <AssistantActionBanner label={assistantActionLabel} note={assistantActionNote} />
      {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}

      <section className="reference-page-heading customers-reference-heading">
        <div className="reference-page-heading-copy">
          <span className="reference-page-kicker">Customers</span>
          <h1>Customer records</h1>
          <p>
            {executiveSummary?.headline ||
              "Run named-customer checkout, loyalty pricing, and repeat-visit tracking from one clean customer record system."}
          </p>
        </div>

        <div className="reference-page-heading-actions">
          <TimeRangeSwitch value={range} onChange={setRange} ariaLabel="Customer reporting range" />
          <button type="button" className="btn btn-primary" onClick={() => navigate("/customers/new")}>
            <FiPlus />
            Add Customer
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

      <section className="soft-action-grid soft-action-grid--four customers-operating-grid">
        {operatingCards.map((card) => (
          <article key={card.title} className="soft-action-card customers-operating-card">
            <div className="soft-action-card-copy">
              <div className="soft-action-card-kicker-wrap">
                <span className="soft-action-card-icon">{card.icon ? <card.icon /> : null}</span>
                <span className="soft-action-card-kicker">{card.title}</span>
              </div>
              <h3>{card.body}</h3>
              <p>{card.meta}</p>
            </div>
            <div className="soft-panel-actions">
              <button type="button" className="btn btn-secondary btn-compact" onClick={card.onClick}>
                {card.action}
              </button>
            </div>
          </article>
        ))}
      </section>

      <section className="soft-main-grid soft-main-grid--customers">
        <article className="soft-panel soft-table-card customers-directory-card">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Customer directory</span>
              <h2>Roster and loyalty status</h2>
            </div>
            <div className="soft-panel-actions">
              {quickFilter !== "all" ? (
                <button type="button" className="btn btn-secondary btn-compact" onClick={() => setQuickFilter("all")}>
                  Clear filter
                </button>
              ) : null}
            </div>
          </header>

          <div className="soft-table-toolbar soft-table-toolbar--filters">
            <div className="reference-inline-search">
              <FiSearch />
              <input
                className="input soft-table-search"
                type="text"
                placeholder="Search customer name, number, email, phone, or notes"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <button
              type="button"
              className={`soft-filter-chip ${quickFilter === "all" ? "is-active" : ""}`}
              onClick={() => setQuickFilter("all")}
            >
              All
            </button>
            <button
              type="button"
              className={`soft-filter-chip ${quickFilter === "eligible" ? "is-active" : ""}`}
              onClick={() => setQuickFilter("eligible")}
            >
              Discount Ready
            </button>
            <button
              type="button"
              className={`soft-filter-chip ${quickFilter === "vip" ? "is-active" : ""}`}
              onClick={() => setQuickFilter("vip")}
            >
              VIP
            </button>
            <button
              type="button"
              className={`soft-filter-chip ${quickFilter === "capture" ? "is-active" : ""}`}
              onClick={() => setQuickFilter("capture")}
            >
              Needs Capture
            </button>
            <button
              type="button"
              className={`soft-filter-chip ${quickFilter === "cooling" ? "is-active" : ""}`}
              onClick={() => setQuickFilter("cooling")}
            >
              Cooling
            </button>
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Customer IDs</th>
                  <th>Tier</th>
                  <th>Orders</th>
                  <th>Lifetime Spend</th>
                  <th>Last Visit</th>
                  <th>Discount</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {directoryRows.length ? (
                  directoryRows.map((customer) => (
                    <tr key={customer.id}>
                      <td>
                        <div className="reference-name-cell">
                          <span className="reference-avatar" data-tone={getIdentityTone(customer?.name, "blue")}>
                            {getIdentityInitials(customer?.name, "CU")}
                          </span>
                          <div>
                            <strong>{customer?.name || "Unnamed customer"}</strong>
                            <div>{customer?.phone || customer?.email || "No contact recorded"}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="customer-directory-tier">
                          <strong>{customer?.customerNumber || "n/a"}</strong>
                          <span>
                            {customer?.loyaltyCardNumber
                              ? `Card ${customer.loyaltyCardNumber}`
                              : "No loyalty card issued"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div className="customer-directory-tier">
                          <strong>{customer?.loyaltyTier || "Guest"}</strong>
                          <span>{customer?.loyaltyStatus || "Profile status unavailable"}</span>
                        </div>
                      </td>
                      <td>{customer?.orderCount || 0}</td>
                      <td>{formatMoney(currency, customer?.lifetimeSpend || 0)}</td>
                      <td>{customer?.lastPurchaseAt ? formatDate(customer.lastPurchaseAt) : "No purchase yet"}</td>
                      <td>
                        <span className={`status-pill small ${customer?.discountEligible ? "success" : "warning"}`}>
                          {customer?.discountEligible ? `${customer?.discountPercent || 0}% live` : "Locked"}
                        </span>
                      </td>
                      <td>
                        <span className={`status-pill small ${customer?.customerStatusTone || "neutral"}`}>
                          {customer?.customerStatus || "New"}
                        </span>
                      </td>
                      <td>
                        <div className="soft-table-actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-compact"
                            onClick={() => navigate(`/customers/${customer.id}`)}
                          >
                            View
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary btn-compact"
                            onClick={() => startPosForCustomer(customer)}
                          >
                            POS
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={9} className="empty-cell">
                      No customer records match the current view.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <SoftPagination currentPage={activeDirectoryPage} totalPages={directoryTotalPages} onChange={setDirectoryPage} />
        </article>

        <div className="soft-side-stack">
          <article className="soft-panel customers-loyalty-panel">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Loyalty Program</span>
                <h3>How named pricing works</h3>
              </div>
            </header>
            <div className="soft-key-value-list">
              <div>
                <span>Member discount</span>
                <strong>{settings?.enableDiscounts ? `${settings?.defaultCustomerDiscountPct || 5}% on named customer checkouts` : "Discounts disabled in settings"}</strong>
              </div>
              <div>
                <span>VIP discount</span>
                <strong>{settings?.vipCustomerDiscountPct || 10}% after 6 orders or CAD 350 lifetime spend</strong>
              </div>
              <div>
                <span>Why capture contact details</span>
                <strong>Phone or email turns a one-off sale into a reusable customer record the next time they shop.</strong>
              </div>
            </div>
          </article>

          <article className="soft-panel customers-loyalty-panel">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Capture Queue</span>
                <h3>First-time shoppers needing follow-up</h3>
              </div>
            </header>
            {captureQueue.length ? (
              <div className="soft-list">
                {captureQueue.slice(0, 5).map((customer) => (
                  <article key={customer.id} className="soft-list-row">
                    <div>
                      <strong>{customer.name}</strong>
                      <small>{customer.customerNumber} | {customer.orderCount || 0} orders</small>
                    </div>
                      <button type="button" className="btn btn-secondary btn-compact" onClick={() => navigate(`/customers/${customer.id}`)}>
                        Open profile
                      </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="customer-record-empty">
                <strong>Capture queue is clear.</strong>
                <p>All named customers already have the contact details needed for repeat checkout and loyalty pricing.</p>
              </div>
            )}
          </article>
        </div>
      </section>

      <section className="soft-section-grid soft-section-grid--two customers-reference-lower">
        <article className="soft-panel">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Customer momentum</span>
              <h2>Named demand over time</h2>
            </div>
          </header>

          <div className="soft-chart-shell soft-chart-shell--short">
            {loading ? (
              <p className="subtle">Loading customer trend...</p>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={trendSeries}>
                  <defs>
                    <linearGradient id="customersTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ANALYTICAL_BLUE_ACCENT} stopOpacity="0.34" />
                      <stop offset="56%" stopColor={ANALYTICAL_BLUE_MID} stopOpacity="0.14" />
                      <stop offset="100%" stopColor={ANALYTICAL_BLUE_FAINT} stopOpacity="0.04" />
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
                    }}
                    formatter={(value) => [formatMoney(currency, value), "Revenue"]}
                  />
                  <Area type="monotone" dataKey="revenue" stroke={ANALYTICAL_BLUE_DEEP} fill="url(#customersTrendFill)" strokeWidth={2.6} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </article>

        <article className="soft-panel">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Customer Watch</span>
              <h3>Who needs staff attention next</h3>
            </div>
          </header>
          <div id="customers-insight-board" className="soft-dual-list customers-insight-list">
            <div className="soft-list">
              <h4>Cooling accounts</h4>
              {coolingCustomers.length ? (
                coolingCustomers.slice(0, 4).map((customer) => (
                  <article key={customer.id} className="soft-list-row">
                    <div>
                      <strong>{customer.name}</strong>
                      <small>{customer.discountReason || "Demand and relationship quality are slipping."}</small>
                    </div>
                    <button type="button" className="btn btn-secondary btn-compact" onClick={() => navigate(`/customers/${customer.id}`)}>
                      View
                    </button>
                  </article>
                ))
              ) : (
                <p className="subtle">No cooling customer profiles are visible right now.</p>
              )}
            </div>
            <div className="soft-list">
              <h4>High-value accounts</h4>
              {discountEligibleCustomers.length ? (
                discountEligibleCustomers.slice(0, 4).map((customer) => (
                  <article key={customer.id} className="soft-list-row">
                    <div>
                      <strong>{customer.name}</strong>
                      <small>
                        {formatMoney(currency, customer?.lifetimeSpend || 0)} lifetime spend | {customer?.orderCount || 0} orders
                      </small>
                    </div>
                    <button type="button" className="btn btn-secondary btn-compact" onClick={() => openOrdersForCustomer(customer?.name)}>
                      Orders
                    </button>
                  </article>
                ))
              ) : (
                <p className="subtle">No discount-ready accounts are visible right now.</p>
              )}
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}

export default Customers;
