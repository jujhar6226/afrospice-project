import { startTransition, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  FaBoxArchive as FiPackage,
  FaChartLine as FiActivity,
  FaMagnifyingGlass as FiSearch,
  FaPlus as FiPlus,
  FaShieldHalved as FiShield,
  FaTruckFast as FiTruck,
} from "react-icons/fa6";

import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import TimeRangeSwitch from "./shared/TimeRangeSwitch";
import SoftPagination from "./shared/SoftPagination";
import { ANALYTICAL_BLUE_DEEP, ANALYTICAL_BLUE_MID } from "./shared/chartTheme";
import { getIdentityInitials, getIdentityTone } from "./shared/identityAvatar";
import {
  firstArrayFrom,
  firstNumberFrom,
  formatMoney,
  formatPercent,
  getResponseData,
  toArray,
  toObject,
} from "./shared/dataHelpers";

const DIRECTORY_PAGE_SIZE = 8;

const emptySupplierDraft = {
  name: "",
  contactName: "",
  email: "",
  phone: "",
  notes: "",
  isActive: true,
};

function toSupplierDraft(supplier = null) {
  return {
    name: String(supplier?.name || ""),
    contactName: String(supplier?.contactName || ""),
    email: String(supplier?.email || ""),
    phone: String(supplier?.phone || ""),
    notes: String(supplier?.notes || ""),
    isActive: Boolean(supplier?.isActive ?? true),
  };
}

function sortSuppliers(items = []) {
  return [...items].sort((left, right) => String(left?.name || "").localeCompare(String(right?.name || "")));
}

function supplierStatusTone(supplier) {
  return supplier?.isActive ? "success" : "danger";
}

function percentageTone(value) {
  const numeric = Number(value || 0);
  if (numeric >= 80) return "success";
  if (numeric >= 50) return "warning";
  return "danger";
}

function signalTone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (
    normalized.includes("good") ||
    normalized.includes("healthy") ||
    normalized.includes("ready") ||
    normalized.includes("active") ||
    normalized.includes("stable")
  ) {
    return "success";
  }
  if (
    normalized.includes("watch") ||
    normalized.includes("review") ||
    normalized.includes("risk") ||
    normalized.includes("delay") ||
    normalized.includes("draft")
  ) {
    return "warning";
  }
  if (
    normalized.includes("inactive") ||
    normalized.includes("critical") ||
    normalized.includes("breach") ||
    normalized.includes("failed")
  ) {
    return "danger";
  }
  return "neutral";
}

function Suppliers({ settings }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [range, setRange] = useState("monthly");
  const [analyticsData, setAnalyticsData] = useState({});
  const [suppliers, setSuppliers] = useState([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState(null);
  const [draft, setDraft] = useState(emptySupplierDraft);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [directoryPage, setDirectoryPage] = useState(1);

  const currency = settings?.currency || "CAD";
  const assistantActionLabel = location.state?.assistantActionLabel || "";
  const assistantActionNote = location.state?.assistantActionNote || "";

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const [analyticsResponse, suppliersResponse] = await Promise.all([
          API.get(`/reports/suppliers?range=${range}`),
          API.get("/suppliers"),
        ]);
        if (cancelled) return;

        startTransition(() => {
          setAnalyticsData(getResponseData(analyticsResponse) || {});
          setSuppliers(sortSuppliers(toArray(getResponseData(suppliersResponse))));
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) setError(requestError?.message || "Could not load supplier data.");
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
    if (!selectedSupplierId) return;

    const selected = suppliers.find((supplier) => String(supplier.id) === String(selectedSupplierId));
    if (!selected) {
      setSelectedSupplierId(null);
      setDraft(emptySupplierDraft);
      return;
    }

    setDraft(toSupplierDraft(selected));
  }, [selectedSupplierId, suppliers]);

  useEffect(() => {
    setDirectoryPage(1);
  }, [query, suppliers.length, range]);

  const summary = useMemo(() => toObject(analyticsData?.summary), [analyticsData]);
  const executiveSummary = useMemo(() => toObject(analyticsData?.executiveSummary), [analyticsData]);
  const topSuppliers = useMemo(() => firstArrayFrom(analyticsData, ["topSuppliers"]).slice(0, 5), [analyticsData]);
  const openOrders = useMemo(() => firstArrayFrom(analyticsData, ["openOrders"]).slice(0, 6), [analyticsData]);
  const exposureRows = useMemo(() => firstArrayFrom(analyticsData, ["suppliers"]).slice(0, 6), [analyticsData]);
  const signals = useMemo(() => firstArrayFrom(analyticsData, ["actionSignals", "watchtower"]).slice(0, 4), [analyticsData]);

  const selectedSupplier = suppliers.find((supplier) => String(supplier.id) === String(selectedSupplierId)) || null;
  const isEditing = Boolean(selectedSupplier);
  const filteredSuppliers = useMemo(() => {
    const term = String(query || "").trim().toLowerCase();
    if (!term) return suppliers;

    return suppliers.filter((supplier) =>
      [supplier?.name, supplier?.contactName, supplier?.email, supplier?.phone, supplier?.notes]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [query, suppliers]);

  const supplierServiceChart = useMemo(
    () =>
      topSuppliers.map((supplier, index) => ({
        label: String(supplier?.supplier || `Supplier ${index + 1}`),
        serviceScore: firstNumberFrom(supplier, ["serviceScore"]),
      })),
    [topSuppliers]
  );

  const summaryCards = [
    {
      label: "Tracked Suppliers",
      value: `${suppliers.length}`,
      note: `${suppliers.filter((supplier) => supplier?.isActive).length} active`,
      icon: FiTruck,
    },
    {
      label: "Weighted Fill Rate",
      value: formatPercent(firstNumberFrom(summary, ["weightedFillRate"])),
      note: `${firstNumberFrom(summary, ["serviceScore"]).toFixed(0)}/100 service`,
      icon: FiActivity,
    },
    {
      label: "Open Commitments",
      value: formatMoney(currency, firstNumberFrom(summary, ["openCommitmentValue"])),
      note: `${openOrders.length} open orders`,
      icon: FiPackage,
    },
    {
      label: "Exposed SKUs",
      value: `${firstNumberFrom(summary, ["exposedSkuCount"])}`,
      note: `${firstNumberFrom(summary, ["atRiskSuppliers"])} suppliers under pressure`,
      icon: FiShield,
    },
  ];

  const directoryTotalPages = Math.max(1, Math.ceil(filteredSuppliers.length / DIRECTORY_PAGE_SIZE));
  const activeDirectoryPage = Math.min(directoryPage, directoryTotalPages);
  const directoryRows = filteredSuppliers.slice(
    (activeDirectoryPage - 1) * DIRECTORY_PAGE_SIZE,
    activeDirectoryPage * DIRECTORY_PAGE_SIZE
  );

  const resetDraft = () => {
    setSelectedSupplierId(null);
    setDraft(emptySupplierDraft);
    setNotice("");
    setError("");
  };

  const openInventoryForSupplier = (supplierName, focus = "inventory-directory") => {
    const nextSupplier = String(supplierName || "").trim();
    if (!nextSupplier) return;

    navigate("/pos-dashboard", {
      state: {
        assistantActionLabel:
          focus === "inventory-create-product" ? `Create stock for ${nextSupplier}` : `Inventory linked to ${nextSupplier}`,
        assistantActionNote:
          focus === "inventory-create-product"
            ? `The inventory product form is prefilled with ${nextSupplier} so a new SKU can be added immediately.`
            : `The inventory workspace is filtered to products, movements, and open purchase orders tied to ${nextSupplier}.`,
        prefillInventoryQuery: focus === "inventory-create-product" ? "" : nextSupplier,
        prefillSupplier: nextSupplier,
        inventoryFocus: focus,
      },
    });
  };

  const saveSupplier = async (event) => {
    event.preventDefault();
    if (saving) return;

    try {
      setSaving(true);
      setError("");
      setNotice("");

      const payload = {
        name: draft.name,
        contactName: draft.contactName || "",
        email: draft.email || "",
        phone: draft.phone || "",
        notes: draft.notes || "",
        isActive: Boolean(draft.isActive),
      };
      const response = isEditing
        ? await API.put(`/suppliers/${selectedSupplier.id}`, payload)
        : await API.post("/suppliers", payload);
      const savedSupplier = getResponseData(response);

      setSuppliers((previous) =>
        sortSuppliers([savedSupplier, ...previous.filter((supplier) => String(supplier.id) !== String(savedSupplier.id))])
      );
      setSelectedSupplierId(savedSupplier?.id || null);
      setDraft(toSupplierDraft(savedSupplier));
      setNotice(
        isEditing
          ? `${savedSupplier?.name || "Supplier"} updated successfully.`
          : `${savedSupplier?.name || "Supplier"} created successfully.`
      );
      setRefreshNonce((value) => value + 1);
    } catch (submitError) {
      setError(submitError?.message || "Could not save the supplier record.");
    } finally {
      setSaving(false);
    }
  };

  const deleteSupplier = async () => {
    if (!selectedSupplier || saving) return;
    if (!window.confirm(`Delete ${selectedSupplier.name}? This cannot be undone.`)) return;

    try {
      setSaving(true);
      setError("");
      setNotice("");
      await API.delete(`/suppliers/${selectedSupplier.id}`);
      setSuppliers((previous) => previous.filter((supplier) => String(supplier.id) !== String(selectedSupplier.id)));
      setSelectedSupplierId(null);
      setDraft(emptySupplierDraft);
      setNotice(`${selectedSupplier.name} deleted successfully.`);
      setRefreshNonce((value) => value + 1);
    } catch (deleteError) {
      setError(deleteError?.message || "Could not delete the supplier record.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container suppliers-ref-page">
      <AssistantActionBanner label={assistantActionLabel} note={assistantActionNote} />
      {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}
      {notice ? <div className="info-banner">{notice}</div> : null}

      <section className="reference-page-heading suppliers-reference-heading">
        <div className="reference-page-heading-copy">
          <span className="reference-page-kicker">Suppliers</span>
          <h1>Suppliers</h1>
          <p>
            {executiveSummary?.headline ||
              "Manage suppliers effectively with cleaner procurement visibility and unified control."}
          </p>
        </div>

        <div className="reference-page-heading-actions">
          <TimeRangeSwitch value={range} onChange={setRange} ariaLabel="Supplier reporting range" />
          <button type="button" className="btn btn-primary" onClick={resetDraft}>
            <FiPlus />
            Add Supplier
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

      <section className="soft-panel soft-panel--compact suppliers-signal-board">
        <header className="soft-panel-header">
          <div>
            <span className="reference-page-kicker">Procurement lanes</span>
            <h2>Supplier signals and next actions</h2>
          </div>
          <button
            type="button"
            className="btn btn-secondary btn-compact"
            onClick={() => document.getElementById("suppliers-insight-board")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            Open Watchboard
          </button>
        </header>
        <div className="soft-card-grid soft-card-grid--four">
          <article className="soft-panel soft-panel--compact suppliers-signal-card">
            <div className="suppliers-signal-card-copy">
              <span className="reference-page-kicker">Best service</span>
              <h3>{topSuppliers[0]?.supplier || "No leader yet"}</h3>
              <p className="subtle">
                {topSuppliers.length
                  ? `${firstNumberFrom(topSuppliers[0], ["serviceScore"]).toFixed(1)} service score`
                  : "No service benchmark has been returned yet."}
              </p>
            </div>
            <div className="soft-panel-actions">
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                onClick={() => openInventoryForSupplier(topSuppliers[0]?.supplier)}
                disabled={!topSuppliers[0]?.supplier}
              >
                Open Inventory
              </button>
            </div>
          </article>

          <article className="soft-panel soft-panel--compact suppliers-signal-card">
            <div className="suppliers-signal-card-copy">
              <span className="reference-page-kicker">Open commitment</span>
              <h3>{openOrders[0]?.supplier || openOrders[0]?.id || "No open order"}</h3>
              <p className="subtle">
                {openOrders.length
                  ? `${formatMoney(currency, firstNumberFrom(openOrders[0], ["orderValue", "value"]))} still moving`
                  : "The open purchase queue is clear right now."}
              </p>
            </div>
            <div className="soft-panel-actions">
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                onClick={() => openInventoryForSupplier(openOrders[0]?.supplier)}
                disabled={!openOrders[0]?.supplier}
              >
                Review Queue
              </button>
            </div>
          </article>

          <article className="soft-panel soft-panel--compact suppliers-signal-card">
            <div className="suppliers-signal-card-copy">
              <span className="reference-page-kicker">Exposure</span>
              <h3>{exposureRows[0]?.supplier || exposureRows[0]?.name || "No risk signal"}</h3>
              <p className="subtle">
                {exposureRows.length
                  ? `${firstNumberFrom(exposureRows[0], ["exposedSkuCount"])} exposed SKUs`
                  : "No exposed supplier line is active right now."}
              </p>
            </div>
            <div className="soft-panel-actions">
              <button
                type="button"
                className="btn btn-secondary btn-compact"
                onClick={() => openInventoryForSupplier(exposureRows[0]?.supplier || exposureRows[0]?.name)}
                disabled={!exposureRows[0]?.supplier && !exposureRows[0]?.name}
              >
                See Stock
              </button>
            </div>
          </article>

          <article className="soft-panel soft-panel--compact suppliers-signal-card">
            <div className="suppliers-signal-card-copy">
              <span className="reference-page-kicker">Watch note</span>
              <h3>{signals[0]?.title || signals[0]?.label || "No live signal"}</h3>
              <p className="subtle">
                {signals[0]?.summary || signals[0]?.message || signals[0]?.note || "No active supplier watch item is visible right now."}
              </p>
            </div>
            <div className="soft-panel-actions" />
          </article>
        </div>
      </section>

      <section className="soft-panel soft-table-card suppliers-directory-card">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Supplier List</span>
              <h2>Supplier directory</h2>
            </div>
          </header>

          <div className="soft-table-toolbar soft-table-toolbar--filters">
            <div className="reference-inline-search">
              <FiSearch />
              <input
                className="input soft-table-search"
                type="text"
                placeholder="Search suppliers, contacts, email, phone, or notes"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            {query ? (
              <button type="button" className="btn btn-secondary" onClick={() => setQuery("")}>
                Clear
              </button>
            ) : null}
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Contact</th>
                  <th>Service</th>
                  <th>Open Orders</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {directoryRows.length ? (
                  directoryRows.map((supplier) => {
                    const serviceEntry =
                      topSuppliers.find(
                        (item) =>
                          String(item?.supplier || "").trim().toLowerCase() ===
                          String(supplier?.name || "").trim().toLowerCase()
                      ) ||
                      exposureRows.find(
                        (item) =>
                          String(item?.supplier || item?.name || "").trim().toLowerCase() ===
                          String(supplier?.name || "").trim().toLowerCase()
                      );
                    const openOrderCount = openOrders.filter(
                      (item) =>
                        String(item?.supplier || "").trim().toLowerCase() ===
                        String(supplier?.name || "").trim().toLowerCase()
                    ).length;

                    return (
                    <tr key={supplier.id}>
                      <td>
                        <div className="reference-name-cell">
                          <span
                            className="reference-avatar reference-avatar--supplier"
                            data-tone={getIdentityTone(supplier?.name, "violet")}
                          >
                            {getIdentityInitials(supplier?.name, "SU")}
                          </span>
                          <div>
                            <strong>{supplier?.name || "Unnamed supplier"}</strong>
                            <div>{supplier?.email || "No email recorded"}</div>
                          </div>
                        </div>
                      </td>
                      <td>{supplier?.contactName || supplier?.phone || "n/a"}</td>
                      <td>
                        {serviceEntry
                          ? `${firstNumberFrom(serviceEntry, ["serviceScore", "fillRate"]).toFixed(1)}${
                              serviceEntry?.serviceScore !== undefined ? "/100" : "%"
                            }`
                          : "n/a"}
                      </td>
                      <td>{openOrderCount || "0"}</td>
                      <td>
                        <span className={`status-pill small ${supplierStatusTone(supplier)}`}>
                          {supplier?.isActive ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td>
                        <div className="soft-table-actions">
                          <button type="button" className="btn btn-secondary btn-compact" onClick={() => setSelectedSupplierId(supplier.id)}>
                            View
                          </button>
                          <button type="button" className="btn btn-primary btn-compact" onClick={() => openInventoryForSupplier(supplier?.name)}>
                            Inventory
                          </button>
                        </div>
                      </td>
                    </tr>
                  )})
                ) : (
                  <tr>
                    <td colSpan={6} className="empty-cell">
                      No suppliers match the current search.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <SoftPagination currentPage={activeDirectoryPage} totalPages={directoryTotalPages} onChange={setDirectoryPage} />
      </section>

      <section className="soft-section-grid soft-section-grid--two suppliers-reference-lower">
        <article className="soft-panel soft-form-panel">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Supplier Profile</span>
              <h2>{isEditing ? selectedSupplier?.name || "Edit supplier" : "Add supplier"}</h2>
            </div>
          </header>

          <form className="stack-form" onSubmit={saveSupplier}>
            <div className="form-two-col">
              <input className="input" value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Supplier name" />
              <input className="input" value={draft.contactName} onChange={(event) => setDraft((current) => ({ ...current, contactName: event.target.value }))} placeholder="Contact name" />
            </div>
            <div className="form-two-col">
              <input className="input" value={draft.email} onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))} placeholder="Email" />
              <input className="input" value={draft.phone} onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))} placeholder="Phone" />
            </div>
            <textarea className="input textarea" rows={4} value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} placeholder="Notes" />
            <label className="settings-control-row">
              <div className="settings-control-copy">
                <span>Supplier active</span>
                <small>Keep the supplier available for receiving and procurement workflows.</small>
              </div>
              <input type="checkbox" checked={Boolean(draft.isActive)} onChange={(event) => setDraft((current) => ({ ...current, isActive: event.target.checked }))} />
            </label>
            <div className="soft-form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving..." : isEditing ? "Save Supplier" : "Create Supplier"}
              </button>
              <button type="button" className="btn btn-secondary" onClick={resetDraft}>
                Reset
              </button>
              {isEditing ? (
                <button type="button" className="btn btn-danger" onClick={deleteSupplier} disabled={saving}>
                  Delete
                </button>
              ) : null}
            </div>
          </form>
        </article>

        <article id="suppliers-insight-board" className="soft-panel suppliers-insight-card">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Service board</span>
              <h3>Supplier execution and exposure</h3>
            </div>
          </header>
          <div className="soft-chart-shell soft-chart-shell--short">
            {loading ? (
              <p className="subtle">Loading suppliers...</p>
            ) : supplierServiceChart.length ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={supplierServiceChart}>
                  <defs>
                    <linearGradient id="suppliersServiceBarFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ANALYTICAL_BLUE_MID} />
                      <stop offset="100%" stopColor={ANALYTICAL_BLUE_DEEP} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "14px" }} formatter={(value) => [Number(value || 0).toFixed(1), "Service score"]} />
                  <Bar dataKey="serviceScore" fill="url(#suppliersServiceBarFill)" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="subtle">No supplier service chart is available yet.</p>
            )}
          </div>
          <div className="soft-list suppliers-insight-list">
            {openOrders.length ? (
              openOrders.slice(0, 3).map((order, index) => (
                <article key={`${order?.id || "po"}-${index}`} className="soft-list-row">
                  <div>
                    <strong>{order?.supplier || order?.id || "Supplier"}</strong>
                    <small>
                      {order?.status || "Unknown status"} / {formatMoney(currency, firstNumberFrom(order, ["orderValue", "value"]))}
                    </small>
                  </div>
                  <span className={`status-pill small ${signalTone(order?.status)}`}>
                    {firstNumberFrom(order, ["qtyOrdered", "itemsCount"])} units
                  </span>
                </article>
              ))
            ) : null}
            {exposureRows.slice(0, 2).map((supplier, index) => (
              <article key={`${supplier?.supplier || supplier?.name || "supplier"}-${index}`} className="soft-list-row">
                <div>
                  <strong>{supplier?.supplier || supplier?.name || "Supplier"}</strong>
                  <small>{firstNumberFrom(supplier, ["exposedSkuCount"])} exposed SKUs</small>
                </div>
                <span className={`status-pill small ${percentageTone(firstNumberFrom(supplier, ["fillRate"]))}`}>
                  {formatPercent(firstNumberFrom(supplier, ["fillRate"]))}
                </span>
              </article>
            ))}
            {signals.slice(0, 2).map((item, index) => (
              <article key={`${item?.title || item?.label || "signal"}-${index}`} className="soft-list-row">
                <div>
                  <strong>{item?.title || item?.label || "Signal"}</strong>
                  <small>{item?.summary || item?.message || item?.note || "No supporting note returned."}</small>
                </div>
                <span className={`status-pill small ${signalTone(item?.tone || item?.value || "watch")}`}>
                  {item?.tone || item?.value || "watch"}
                </span>
              </article>
            ))}
            {!openOrders.length && !exposureRows.length && !signals.length ? (
              <p className="subtle">No supplier signals are active right now.</p>
            ) : null}
          </div>
        </article>
      </section>
    </div>
  );
}

export default Suppliers;
