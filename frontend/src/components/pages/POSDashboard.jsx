import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  FaBoxArchive as FiPackage,
  FaChartLine as FiActivity,
  FaDollarSign as FiDollarSign,
  FaTriangleExclamation as FiAlertTriangle,
} from "react-icons/fa6";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import CommandDockPanel from "./inventory/CommandDockPanel";
import InventoryDirectoryPanel from "./inventory/InventoryDirectoryPanel";
import ReorderPlannerPanel from "./inventory/ReorderPlannerPanel";
import {
  clamp,
  emptyForm,
  escapeCsv,
  formatMoney,
  formatDateTime,
  formatRelativeTime,
  getMovementLabel,
  makeSkuFromName,
  normalizeCode,
  normalizeCycleCountsResponse,
  normalizeMovementsResponse,
  normalizeProductsResponse,
  normalizePurchaseOrdersResponse,
  sanitizeText,
} from "./inventory/helpers";
import { getResponseData, toArray } from "./shared/dataHelpers";
import { ANALYTICAL_BLUE_ACCENT, ANALYTICAL_BLUE_DEEP, ANALYTICAL_BLUE_FAINT, ANALYTICAL_BLUE_MID } from "./shared/chartTheme";
import OperationsRail from "./inventory/OperationsRail";

const INVENTORY_DIRECTORY_PAGE_SIZE = 10;

function InventoryActionButton({ item, navigate }) {
  const handleClick = () => {
    if (item.to) {
      navigate(item.to);
      return;
    }
    item.onClick?.();
  };

  return (
    <button type="button" className="inventory-ref-action" onClick={handleClick}>
      <span className="inventory-ref-action-copy">
        <small>{item.eyebrow}</small>
        <strong>{item.title}</strong>
      </span>
      {item.badge ? <span className="status-pill small neutral">{item.badge}</span> : null}
    </button>
  );
}

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInteger(value, fallback = 0) {
  const parsed = Math.round(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function buildProductSignals(products = [], movements = [], lowStockThreshold = 10) {
  const movementMap = new Map();
  const recentWindowMs = 14 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const criticalThreshold = Math.max(3, Math.round(lowStockThreshold / 2));

  for (const movement of movements) {
    const productId = toInteger(movement?.productId);
    if (!productId) continue;

    const current = movementMap.get(productId) || {
      recentUnitsSold: 0,
      lastSoldAt: null,
    };
    const createdAt = movement?.createdAt || null;
    const createdAtTime = new Date(createdAt || 0).getTime();

    if (
      ["sale", "sale_capture"].includes(String(movement?.movementType || "")) &&
      toNumber(movement?.quantityDelta) < 0
    ) {
      current.recentUnitsSold +=
        createdAtTime >= now - recentWindowMs ? Math.abs(toNumber(movement?.quantityDelta)) : 0;

      if (!current.lastSoldAt || createdAtTime > new Date(current.lastSoldAt).getTime()) {
        current.lastSoldAt = createdAt;
      }
    }

    movementMap.set(productId, current);
  }

  return [...products]
    .map((product) => {
      const stock = toInteger(product?.stock);
      const price = toNumber(product?.price);
      const unitCost = toNumber(product?.unitCost);
      const movementSignal = movementMap.get(toInteger(product?.id)) || {
        recentUnitsSold: 0,
        lastSoldAt: null,
      };
      const averageDailyUnits = movementSignal.recentUnitsSold / 14;
      const estimatedDaysCover =
        averageDailyUnits > 0 ? Number((stock / averageDailyUnits).toFixed(1)) : null;
      const daysSinceLastSale = movementSignal.lastSoldAt
        ? Math.floor((now - new Date(movementSignal.lastSoldAt).getTime()) / (24 * 60 * 60 * 1000))
        : null;

      let lane = "healthy";
      let status = "Healthy";
      if (stock <= criticalThreshold) {
        lane = "critical";
        status = "Critical";
      } else if (stock <= lowStockThreshold || (estimatedDaysCover !== null && estimatedDaysCover <= 7)) {
        lane = "reorder";
        status = "Reorder Soon";
      } else if (stock > lowStockThreshold * 2 && (daysSinceLastSale === null || daysSinceLastSale >= 30)) {
        lane = "dormant";
        status = "Dormant";
      }

      return {
        ...product,
        stock,
        price,
        unitCost,
        stockValue: stock * (unitCost > 0 ? unitCost : price),
        recentUnitsSold: movementSignal.recentUnitsSold,
        lastSoldAt: movementSignal.lastSoldAt,
        estimatedDaysCover,
        status,
        lane,
      };
    })
    .sort((left, right) => {
      const laneOrder = { critical: 0, reorder: 1, dormant: 2, healthy: 3 };
      const laneDiff = (laneOrder[left?.lane] ?? 99) - (laneOrder[right?.lane] ?? 99);
      if (laneDiff !== 0) return laneDiff;
      return String(left?.name || "").localeCompare(String(right?.name || ""));
    });
}

function getRecommendedQty(product, lowStockThreshold) {
  const stock = toInteger(product?.stock);
  const velocityTarget = Math.ceil((toNumber(product?.recentUnitsSold) / 14) * 21);
  const floorTarget = Math.max(lowStockThreshold * 2, velocityTarget, 12);
  return Math.max(1, floorTarget - stock);
}

function downloadText(filename, content, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.URL.revokeObjectURL(url);
}

function POSDashboard({ settings, lowStockThreshold = 10 }) {
  const location = useLocation();
  const navigate = useNavigate();
  const scanRef = useRef(null);
  const prefillSupplier = sanitizeText(location.state?.prefillSupplier);
  const prefillInventoryQuery = String(location.state?.prefillInventoryQuery ?? "");
  const inventoryFocus = sanitizeText(location.state?.inventoryFocus);
  const [products, setProducts] = useState([]);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [movements, setMovements] = useState([]);
  const [cycleCounts, setCycleCounts] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [inventoryLane, setInventoryLane] = useState("all");
  const [inventoryPage, setInventoryPage] = useState(1);
  const [selectedDraftIds, setSelectedDraftIds] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [scanValue, setScanValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [operationsTab, setOperationsTab] = useState("orders");
  const [cycleCountValues, setCycleCountValues] = useState({});
  const [preferredSupplier, setPreferredSupplier] = useState("");
  const deferredQuery = useDeferredValue(query);
  const currency = settings?.currency || "CAD";

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const [productsResponse, movementsResponse, purchaseOrdersResponse, cycleCountsResponse] =
          await Promise.all([
            API.get("/products"),
            API.get("/products/movements/recent?limit=120"),
            API.get("/purchase-orders?limit=18"),
            API.get("/cycle-counts?limit=10"),
          ]);

        if (cancelled) return;

        startTransition(() => {
          setProducts(normalizeProductsResponse(getResponseData(productsResponse)));
          setMovements(normalizeMovementsResponse(getResponseData(movementsResponse)));
          setPurchaseOrders(normalizePurchaseOrdersResponse(getResponseData(purchaseOrdersResponse)));
          setCycleCounts(normalizeCycleCountsResponse(getResponseData(cycleCountsResponse)));
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError?.message || "Could not load the inventory workspace.");
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
  }, [refreshNonce]);

  useEffect(() => {
    if (prefillInventoryQuery) setQuery(prefillInventoryQuery);
    if (prefillSupplier) {
      setPreferredSupplier(prefillSupplier);
      setFormData((current) => ({ ...current, supplier: prefillSupplier }));
    }

    if (inventoryFocus) {
      window.setTimeout(() => {
        document.getElementById(inventoryFocus)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 180);
    }
  }, [inventoryFocus, location.key, prefillInventoryQuery, prefillSupplier]);

  const productSignals = useMemo(
    () => buildProductSignals(products, movements, toInteger(lowStockThreshold, 10)),
    [products, movements, lowStockThreshold]
  );
  const categories = useMemo(
    () => ["All", ...new Set(productSignals.map((product) => sanitizeText(product?.category || "General")))],
    [productSignals]
  );
  const priorityQueue = useMemo(
    () => productSignals.filter((product) => ["critical", "reorder"].includes(product?.lane)),
    [productSignals]
  );
  const activeCycleCount = useMemo(
    () => cycleCounts.find((count) => String(count?.status || "") === "Open") || null,
    [cycleCounts]
  );

  useEffect(() => {
    if (!activeCycleCount) {
      setCycleCountValues({});
      return;
    }

    const nextValues = {};
    for (const item of toArray(activeCycleCount?.items)) {
      nextValues[item.productId] = item.countedQty ?? item.expectedQty ?? 0;
    }
    setCycleCountValues(nextValues);
  }, [activeCycleCount]);

  const stats = useMemo(() => {
    const totalUnits = productSignals.reduce((sum, product) => sum + toInteger(product?.stock), 0);
    const inventoryValue = productSignals.reduce((sum, product) => sum + toNumber(product?.stockValue), 0);
    const lowStockCount = productSignals.filter((product) => ["critical", "reorder"].includes(product?.lane)).length;
    const criticalCount = productSignals.filter((product) => product?.lane === "critical").length;
    return {
      totalProducts: productSignals.length,
      totalUnits,
      inventoryValue,
      lowStockCount,
      criticalCount,
    };
  }, [productSignals]);

  const dormantProducts = useMemo(
    () => productSignals.filter((product) => product?.lane === "dormant"),
    [productSignals]
  );
  const dormantValue = useMemo(
    () => dormantProducts.reduce((sum, product) => sum + toNumber(product?.stockValue), 0),
    [dormantProducts]
  );
  const filteredProducts = useMemo(() => {
    const normalizedQuery = normalizeCode(deferredQuery);

    return productSignals.filter((product) => {
      const matchesLane = inventoryLane === "all" || product?.lane === inventoryLane;
      const matchesCategory = category === "All" || sanitizeText(product?.category) === sanitizeText(category);
      const matchesQuery =
        !normalizedQuery ||
        normalizeCode([product?.name, product?.sku, product?.barcode, product?.supplier, product?.category].join(" ")).includes(normalizedQuery);
      return matchesLane && matchesCategory && matchesQuery;
    });
  }, [category, deferredQuery, inventoryLane, productSignals]);

  const filteredPurchaseOrders = useMemo(() => {
    const normalizedQuery = normalizeCode(deferredQuery);
    return purchaseOrders.filter((order) =>
      !normalizedQuery ||
      normalizeCode([order?.id, order?.supplier, order?.status, order?.note].join(" ")).includes(normalizedQuery)
    );
  }, [deferredQuery, purchaseOrders]);

  const filteredMovements = useMemo(() => {
    const normalizedQuery = normalizeCode(deferredQuery);
    return movements.filter((movement) =>
      !normalizedQuery ||
      normalizeCode([movement?.productName, movement?.sku, movement?.movementType, movement?.note, movement?.referenceId].join(" ")).includes(normalizedQuery)
    );
  }, [deferredQuery, movements]);

  const filteredCycleCounts = useMemo(() => {
    const normalizedQuery = normalizeCode(deferredQuery);
    return cycleCounts.filter((count) =>
      !normalizedQuery ||
      normalizeCode([count?.id, count?.status, count?.note, count?.createdBy].join(" ")).includes(normalizedQuery)
    );
  }, [cycleCounts, deferredQuery]);

  const laneOptions = useMemo(
    () => [
      { key: "all", label: "All", count: productSignals.length },
      { key: "critical", label: "Critical", count: productSignals.filter((product) => product?.lane === "critical").length },
      { key: "reorder", label: "Reorder", count: productSignals.filter((product) => product?.lane === "reorder").length },
      { key: "dormant", label: "Dormant", count: dormantProducts.length },
      { key: "healthy", label: "Healthy", count: productSignals.filter((product) => product?.lane === "healthy").length },
    ],
    [dormantProducts.length, productSignals]
  );
  const laneChartData = useMemo(
    () => laneOptions.filter((item) => item.key !== "all").map((item) => ({ label: item.label, count: item.count })),
    [laneOptions]
  );
  const movementTrend = useMemo(() => {
    const buckets = new Map();
    const recent = [...movements]
      .filter((movement) => movement?.createdAt)
      .slice(0, 36)
      .reverse();

    for (const movement of recent) {
      const date = new Date(movement.createdAt);
      if (Number.isNaN(date.getTime())) continue;
      const label = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
      const current = buckets.get(label) || {
        label,
        movementCount: 0,
        netUnits: 0,
      };
      current.movementCount += 1;
      current.netUnits += toNumber(movement?.quantityDelta);
      buckets.set(label, current);
    }

    return [...buckets.values()].slice(-8);
  }, [movements]);

  const purchaseOrderStats = useMemo(() => {
    const openOrders = purchaseOrders.filter((order) =>
      ["Draft", "Sent", "Partially Received"].includes(String(order?.status || ""))
    );
    return {
      open: openOrders.length,
      drafts: purchaseOrders.filter((order) => String(order?.status || "") === "Draft").length,
      inboundUnits: openOrders.reduce((sum, order) => sum + toInteger(order?.openUnits), 0),
    };
  }, [purchaseOrders]);

  const cycleCountStats = useMemo(
    () => ({
      recentVariance: cycleCounts.slice(0, 4).reduce((sum, count) => sum + toNumber(count?.varianceUnits), 0),
    }),
    [cycleCounts]
  );

  const heroScore = clamp(
    100 -
      stats.criticalCount * 10 -
      Math.max(0, stats.lowStockCount - stats.criticalCount) * 4 -
      dormantProducts.length * 2 -
      (activeCycleCount ? 3 : 0),
    38,
    99
  );

  const heroTone = heroScore >= 86 ? "Balanced" : heroScore >= 70 ? "Watchlist" : "Pressure";
  const heroToneClass = heroScore >= 86 ? "success" : heroScore >= 70 ? "warning" : "danger";
  const inventoryBriefs = [
    {
      label: "Inbound queue",
      value: `${purchaseOrderStats.open} open orders`,
      note: `${purchaseOrderStats.inboundUnits} units are still waiting to land.`,
      badge: `${purchaseOrderStats.drafts} live drafts`,
    },
    {
      label: "Cycle count lane",
      value: activeCycleCount ? activeCycleCount.id : "No open count",
      note: activeCycleCount
        ? `${activeCycleCount.linesCount} lines are waiting for verification.`
        : "Start a quick count from the priority queue below.",
      badge: activeCycleCount ? `${activeCycleCount.linesCount} lines` : "Ready",
      tone: activeCycleCount ? "warning" : "success",
    },
    {
      label: "Latest movement",
      value: movements[0]?.productName || "No movement yet",
      note: movements[0]
        ? `${getMovementLabel(movements[0]?.movementType)} ${formatRelativeTime(movements[0]?.createdAt)}`
        : "New stock activity will appear here once the floor changes.",
      badge: movements[0] ? formatDateTime(movements[0]?.createdAt) : "",
    },
  ];

  const liveStatusNote = movements[0]?.createdAt
    ? `Last change ${formatRelativeTime(movements[0]?.createdAt)}`
    : "No recent movement";

  const inventoryCommandItems = [
    {
      key: "reorder",
      eyebrow: "Replenishment",
      title: "Draft the next supplier move",
      description: "Go directly to the reorder planner and turn current pressure lines into live purchase-order drafts.",
      badge: `${priorityQueue.length} priority lines`,
      badgeTone: priorityQueue.length ? "warning" : "success",
      metaLabel: "Suggested spend",
      meta: formatMoney(
        priorityQueue
          .filter((product) => selectedDraftIds.some((id) => String(id) === String(product.id)))
          .reduce(
            (sum, product) =>
              sum + getRecommendedQty(product, toInteger(lowStockThreshold, 10)) * toNumber(product?.unitCost || product?.price),
            0
          )
      ),
      actionLabel: "Open Reorder Planner",
      onClick: () =>
        document.getElementById("inventory-reorder-planner")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      emphasis: true,
    },
    {
      key: "counts",
      eyebrow: "Accuracy",
      title: "Run the next count cycle",
      description: "Move into the count lane when the floor needs verification before more buying or corrections happen.",
      badge: activeCycleCount ? "count open" : "ready",
      badgeTone: activeCycleCount ? "warning" : "success",
      metaLabel: "Count posture",
      meta: activeCycleCount?.id || "No open count",
      actionLabel: "Open Count Lane",
      onClick: () => {
        setOperationsTab("counts");
        document.getElementById("inventory-operations")?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    },
    {
      key: "dock",
      eyebrow: "Catalog",
      title: "Correct or add a SKU fast",
      description: "Drop into the command dock to patch live catalog data, scan a code, or create a product tied to a supplier.",
      badge: editingId ? "editing live SKU" : "dock ready",
      badgeTone: editingId ? "warning" : "neutral",
      metaLabel: "Preferred supplier",
      meta: preferredSupplier || "No pinned supplier",
      actionLabel: "Open Command Dock",
      onClick: () =>
        document.getElementById("inventory-create-product")?.scrollIntoView({ behavior: "smooth", block: "start" }),
    },
    {
      key: "suppliers",
      eyebrow: "Supply",
      title: "Review supplier control",
      description: "Open supplier management when receipt pressure or replenishment choices need supplier-level context.",
      badge: `${purchaseOrderStats.open} open orders`,
      badgeTone: purchaseOrderStats.open ? "warning" : "neutral",
      metaLabel: "Inbound units",
      meta: `${purchaseOrderStats.inboundUnits} units`,
      actionLabel: "Open Suppliers",
      to: "/suppliers",
      secondaryLabel: "Open Terminal",
      secondaryTo: "/terminal",
    },
  ];

  useEffect(() => {
    setInventoryPage(1);
  }, [category, deferredQuery, inventoryLane]);

  const inventoryTotalPages = Math.max(
    1,
    Math.ceil(filteredProducts.length / INVENTORY_DIRECTORY_PAGE_SIZE)
  );
  const activeInventoryPage = Math.min(inventoryPage, inventoryTotalPages);
  const pagedInventoryProducts = useMemo(
    () =>
      filteredProducts.slice(
        (activeInventoryPage - 1) * INVENTORY_DIRECTORY_PAGE_SIZE,
        activeInventoryPage * INVENTORY_DIRECTORY_PAGE_SIZE
      ),
    [activeInventoryPage, filteredProducts]
  );

  const resetForm = () => {
    setEditingId(null);
    setScanValue("");
    setFormData({ ...emptyForm, supplier: preferredSupplier });
    setNotice("");
    setError("");
    scanRef.current?.focus();
  };

  const populateForm = (product) => {
    setEditingId(product.id);
    setFormData({
      name: String(product?.name || ""),
      sku: String(product?.sku || ""),
      barcode: String(product?.barcode || ""),
      category: String(product?.category || ""),
      supplier: String(product?.supplier || ""),
      price: String(product?.price ?? ""),
      unitCost: String(product?.unitCost ?? ""),
      stock: String(product?.stock ?? ""),
    });
    document.getElementById("inventory-create-product")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const onScanSubmit = (event) => {
    event.preventDefault();
    const normalizedScan = normalizeCode(scanValue);
    if (!normalizedScan) return;

    const match = productSignals.find((product) =>
      [product?.barcode, product?.sku, product?.name].map((value) => normalizeCode(value)).includes(normalizedScan)
    );

    if (match) {
      populateForm(match);
      return;
    }

    setEditingId(null);
    setFormData((current) => ({
      ...current,
      barcode: /^\d{6,}$/.test(scanValue) ? scanValue : current.barcode,
      sku: current.sku || (/^\d{6,}$/.test(scanValue) ? "" : String(scanValue || "").toUpperCase()),
      supplier: current.supplier || preferredSupplier,
    }));
    setNotice("No existing SKU matched the scan. The command dock is ready for a new product.");
  };

  const onFormChange = (event) => {
    const { name, value } = event.target;
    setFormData((current) => {
      const next = { ...current, [name]: value };
      if (name === "name" && !editingId && !sanitizeText(current.sku)) {
        next.sku = makeSkuFromName(value);
      }
      return next;
    });
  };

  const saveProduct = async (event) => {
    event.preventDefault();
    if (saving) return;

    try {
      setSaving(true);
      setError("");
      const payload = {
        name: sanitizeText(formData.name),
        sku: sanitizeText(formData.sku),
        barcode: sanitizeText(formData.barcode),
        category: sanitizeText(formData.category),
        supplier: sanitizeText(formData.supplier),
        price: toNumber(formData.price),
        unitCost: toNumber(formData.unitCost),
        stock: Math.max(0, toInteger(formData.stock)),
      };

      const response = editingId ? await API.put(`/products/${editingId}`, payload) : await API.post("/products", payload);
      const saved = getResponseData(response);
      setNotice(
        editingId ? `${saved?.name || "Product"} updated successfully.` : `${saved?.name || "Product"} created successfully.`
      );
      setEditingId(saved?.id || null);
      setRefreshNonce((current) => current + 1);
    } catch (submitError) {
      setError(submitError?.message || "Could not save the product.");
    } finally {
      setSaving(false);
    }
  };

  const quickRestock = async (product) => {
    const amountInput = window.prompt(`Restock amount for ${product.name}`, String(getRecommendedQty(product, toInteger(lowStockThreshold, 10))));
    if (amountInput === null) return;
    const amount = Math.max(0, toInteger(amountInput));
    if (!amount) return;

    try {
      setActionBusy(`restock-${product.id}`);
      setError("");
      await API.patch(`/products/${product.id}/restock`, {
        amount,
        note: `Manual restock from inventory workspace for ${product.name}.`,
      });
      setNotice(`${product.name} restocked by ${amount} units.`);
      setRefreshNonce((current) => current + 1);
    } catch (restockError) {
      setError(restockError?.message || "Could not restock the selected product.");
    } finally {
      setActionBusy("");
    }
  };

  const deleteProduct = async (product) => {
    if (!window.confirm(`Delete ${product.name}? This cannot be undone.`)) return;
    try {
      setSaving(true);
      setError("");
      await API.delete(`/products/${product.id}`);
      if (String(editingId) === String(product.id)) resetForm();
      setNotice(`${product.name} deleted successfully.`);
      setRefreshNonce((current) => current + 1);
    } catch (deleteError) {
      setError(deleteError?.message || "Could not delete the selected product.");
    } finally {
      setSaving(false);
    }
  };

  const exportDraft = () => {
    const selected = priorityQueue.filter((product) =>
      selectedDraftIds.some((id) => String(id) === String(product.id))
    );
    if (!selected.length) {
      setError("Select one or more reorder lines before exporting the draft.");
      return;
    }

    const rows = [
      ["supplier", "productId", "productName", "sku", "qtyOrdered", "unitCost"].join(","),
      ...selected.map((product) =>
        [
          escapeCsv(product?.supplier || "General Supplier"),
          escapeCsv(product?.id),
          escapeCsv(product?.name),
          escapeCsv(product?.sku),
          escapeCsv(getRecommendedQty(product, toInteger(lowStockThreshold, 10))),
          escapeCsv(product?.unitCost || product?.price || 0),
        ].join(",")
      ),
    ].join("\n");

    downloadText(`inventory-reorder-draft-${new Date().toISOString().slice(0, 10)}.csv`, rows, "text/csv;charset=utf-8");
    setNotice("Reorder draft exported.");
  };

  const createPurchaseOrders = async () => {
    const selected = priorityQueue.filter((product) =>
      selectedDraftIds.some((id) => String(id) === String(product.id))
    );
    if (!selected.length) {
      setError("Select one or more reorder lines before creating purchase orders.");
      return;
    }

    try {
      setActionBusy("create-po");
      setError("");
      await API.post("/purchase-orders/bulk-draft", {
        items: selected.map((product) => ({
          productId: product.id,
          supplier: product.supplier,
          qtyOrdered: getRecommendedQty(product, toInteger(lowStockThreshold, 10)),
          unitCost: product.unitCost || product.price || 0,
        })),
      });
      setNotice("Live purchase-order drafts created from the reorder planner.");
      setSelectedDraftIds([]);
      setOperationsTab("orders");
      setRefreshNonce((current) => current + 1);
    } catch (createError) {
      setError(createError?.message || "Could not create purchase orders.");
    } finally {
      setActionBusy("");
    }
  };

  const markPurchaseOrderStatus = async (orderId, status) => {
    try {
      setActionBusy(`status-${orderId}`);
      setError("");
      await API.patch(`/purchase-orders/${orderId}/status`, { status });
      setNotice(`${orderId} updated to ${status}.`);
      setRefreshNonce((current) => current + 1);
    } catch (statusError) {
      setError(statusError?.message || "Could not update the purchase order.");
    } finally {
      setActionBusy("");
    }
  };

  const receivePurchaseOrder = async (orderId) => {
    try {
      setActionBusy(`receive-${orderId}`);
      setError("");
      await API.post(`/purchase-orders/${orderId}/receive`, {});
      setNotice(`${orderId} received successfully.`);
      setRefreshNonce((current) => current + 1);
    } catch (receiveError) {
      setError(receiveError?.message || "Could not receive the purchase order.");
    } finally {
      setActionBusy("");
    }
  };

  const createCycleCount = async () => {
    const selected = priorityQueue.filter((product) =>
      selectedDraftIds.some((id) => String(id) === String(product.id))
    );
    const source = selected.length ? selected : priorityQueue.slice(0, 5);
    if (!source.length) {
      setError("No inventory lines are available for a quick count.");
      return;
    }

    try {
      setActionBusy("create-count");
      setError("");
      await API.post("/cycle-counts/quick-draft", {
        items: source.map((product) => ({ productId: product.id })),
      });
      setNotice("Live cycle-count draft created from the current pressure lines.");
      setOperationsTab("counts");
      setRefreshNonce((current) => current + 1);
    } catch (createError) {
      setError(createError?.message || "Could not create the cycle count.");
    } finally {
      setActionBusy("");
    }
  };

  const changeCycleCountValue = (productId, value) => {
    setCycleCountValues((current) => ({
      ...current,
      [productId]: value,
    }));
  };

  const completeCycleCount = async (count) => {
    if (!count) return;
    try {
      setActionBusy(`count-${count.id}`);
      setError("");
      await API.post(`/cycle-counts/${count.id}/complete`, {
        items: toArray(count?.items).map((item) => ({
          productId: item.productId,
          countedQty: Math.max(0, toInteger(cycleCountValues[item.productId] ?? item.expectedQty)),
        })),
      });
      setNotice(`${count.id} completed successfully.`);
      setRefreshNonce((current) => current + 1);
    } catch (completeError) {
      setError(completeError?.message || "Could not complete the cycle count.");
    } finally {
      setActionBusy("");
    }
  };

  return (
    <div className="page-container inventory-page inventory-reference-page">
      <AssistantActionBanner
        label={location.state?.assistantActionLabel || ""}
        note={location.state?.assistantActionNote || ""}
      />

      {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}
      {notice ? <div className="info-banner">{notice}</div> : null}

      <section className="reference-page-heading inventory-reference-heading">
        <div className="reference-page-heading-copy">
          <span className="reference-page-kicker">Stock workspace</span>
          <h1>Inventory</h1>
          <p>
            Search, replenish, receive, and repair the live catalog from one cleaner operating surface. {liveStatusNote}.
          </p>
        </div>

        <div className="inventory-reference-heading-actions">
          {inventoryCommandItems.map((item) => (
            <InventoryActionButton key={item.key} item={item} navigate={navigate} />
          ))}
        </div>
      </section>

      <section className="inventory-reference-summary">
        <article className={`inventory-reference-stat inventory-reference-stat--${heroToneClass}`}>
          <div className="reference-stat-head">
            <div className="reference-stat-icon">
              <FiActivity />
            </div>
          </div>
          <span>Inventory health</span>
          <strong>{heroScore}</strong>
          <small>{heroTone} across the live stock posture.</small>
        </article>
        <article className="inventory-reference-stat">
          <div className="reference-stat-head">
            <div className="reference-stat-icon">
              <FiDollarSign />
            </div>
          </div>
          <span>Inventory value</span>
          <strong>{formatMoney(currency, stats.inventoryValue)}</strong>
          <small>{stats.totalUnits} units across the live catalog.</small>
        </article>
        <article className="inventory-reference-stat">
          <div className="reference-stat-head">
            <div className="reference-stat-icon">
              <FiAlertTriangle />
            </div>
          </div>
          <span>Low stock items</span>
          <strong>{stats.lowStockCount}</strong>
          <small>{stats.criticalCount} critical lines need priority attention.</small>
        </article>
        <article className="inventory-reference-stat">
          <div className="reference-stat-head">
            <div className="reference-stat-icon">
              <FiPackage />
            </div>
          </div>
          <span>Inbound orders</span>
          <strong>{purchaseOrderStats.open}</strong>
          <small>{purchaseOrderStats.inboundUnits} units are still waiting to land.</small>
        </article>
      </section>

      <section className="inventory-reference-shell">
        <div className="inventory-reference-main">
          <div id="inventory-directory">
            <InventoryDirectoryPanel
              filteredProducts={pagedInventoryProducts}
              filteredProductCount={filteredProducts.length}
              stats={stats}
              query={query}
              category={category}
              categories={categories}
              inventoryLane={inventoryLane}
              laneOptions={laneOptions}
              currentPage={activeInventoryPage}
              totalPages={inventoryTotalPages}
              tableLoading={loading}
              onPageChange={setInventoryPage}
              onQueryChange={setQuery}
              onCategoryChange={setCategory}
              onInventoryLaneChange={setInventoryLane}
              onPopulateForm={populateForm}
              onQuickRestock={quickRestock}
              onDelete={deleteProduct}
            />
          </div>
        </div>

        <aside className="inventory-reference-side">
          <div id="inventory-reorder-planner">
            <ReorderPlannerPanel
              priorityQueue={priorityQueue}
              selectedDraftIds={selectedDraftIds}
              selectedDraftItemsLength={selectedDraftIds.length}
              draftUnits={priorityQueue
                .filter((product) => selectedDraftIds.some((id) => String(id) === String(product.id)))
                .reduce((sum, product) => sum + getRecommendedQty(product, toInteger(lowStockThreshold, 10)), 0)}
              dormantValue={dormantValue}
              dormantCount={dormantProducts.length}
              actionBusy={actionBusy}
              onSelectAll={() =>
                setSelectedDraftIds(
                  selectedDraftIds.length === priorityQueue.length ? [] : priorityQueue.map((product) => product.id)
                )
              }
              onCreatePurchaseOrders={createPurchaseOrders}
              onExportDraft={exportDraft}
              onToggleDraftSelection={(productId) =>
                setSelectedDraftIds((current) =>
                  current.some((id) => String(id) === String(productId))
                    ? current.filter((id) => String(id) !== String(productId))
                    : [...current, productId]
                )
              }
              onPopulateForm={populateForm}
              onQuickRestock={quickRestock}
              getRecommendedQty={(product) => getRecommendedQty(product, toInteger(lowStockThreshold, 10))}
              liveNow={Date.now()}
            />
          </div>

          <div id="inventory-create-product">
            <CommandDockPanel
              editingId={editingId}
              scanRef={scanRef}
              scanValue={scanValue}
              formData={formData}
              loading={saving}
              onScanValueChange={setScanValue}
              onScanSubmit={onScanSubmit}
              onChange={onFormChange}
              onSubmit={saveProduct}
              onReset={resetForm}
              operationsRail={
                <div className="inventory-command-note">
                  Product edits here write directly to the live catalog and feed the receiving and cycle-count tools below.
                </div>
              }
            />
          </div>
        </aside>
      </section>

      <section className="inventory-reference-insights">
        <article className="dashboard-ref-panel inventory-reference-analytics">
          <header className="dashboard-ref-panel-head">
            <div>
              <span className="dashboard-ref-panel-kicker">Inventory intelligence</span>
              <h3>Stock mix, movement rhythm, and live pressure</h3>
            </div>
            <div className="live-indicator-row">
              {movements[0]?.createdAt ? (
                <span className="live-indicator" aria-label="Live stock signals" title="Live stock signals" />
              ) : (
                <span className="status-pill small neutral">Paused</span>
              )}
              <small>{liveStatusNote}</small>
            </div>
          </header>

          <div className="inventory-reference-chart-grid">
            <div className="dashboard-ref-chart-shell dashboard-ref-chart-shell--compact">
              {laneChartData.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={laneChartData}>
                    <defs>
                      <linearGradient id="inventoryLaneBarFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ANALYTICAL_BLUE_MID} />
                        <stop offset="100%" stopColor={ANALYTICAL_BLUE_DEEP} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "14px",
                        color: "var(--text-primary)",
                      }}
                    />
                    <Bar dataKey="count" radius={[10, 10, 0, 0]} fill="url(#inventoryLaneBarFill)" maxBarSize={38} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="subtle">No stock health distribution is available yet.</p>
              )}
            </div>

            <div className="dashboard-ref-chart-shell dashboard-ref-chart-shell--compact">
              {movementTrend.length ? (
                <ResponsiveContainer width="100%" height={240}>
                  <AreaChart data={movementTrend}>
                    <defs>
                      <linearGradient id="inventoryMovementFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={ANALYTICAL_BLUE_ACCENT} stopOpacity="0.34" />
                        <stop offset="56%" stopColor={ANALYTICAL_BLUE_MID} stopOpacity="0.14" />
                        <stop offset="100%" stopColor={ANALYTICAL_BLUE_FAINT} stopOpacity="0.04" />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "14px",
                        color: "var(--text-primary)",
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="movementCount"
                      stroke={ANALYTICAL_BLUE_DEEP}
                      fill="url(#inventoryMovementFill)"
                      strokeWidth={2.8}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="subtle">No recent movement rhythm is available yet.</p>
              )}
            </div>
          </div>

          <div className="inventory-reference-brief-row">
            {inventoryBriefs.map((brief) => (
              <article key={brief.label} className="inventory-reference-brief-card">
                <span>{brief.label}</span>
                <strong>{brief.value}</strong>
                <small>{brief.note}</small>
              </article>
            ))}
          </div>
        </article>
      </section>

      <div id="inventory-operations" className="inventory-reference-operations">
        <OperationsRail
          actionBusy={actionBusy}
          purchaseOrderStats={purchaseOrderStats}
          activeCycleCount={activeCycleCount}
          cycleCountStats={cycleCountStats}
          operationsTab={operationsTab}
          onSetOperationsTab={setOperationsTab}
          opsLoading={loading}
          purchaseOrders={filteredPurchaseOrders}
          movements={filteredMovements}
          cycleCounts={filteredCycleCounts}
          cycleCountValues={cycleCountValues}
          onBackupExport={() => setNotice("Use the Settings workspace for controlled backups.")}
          onPurchaseOrderStatus={markPurchaseOrderStatus}
          onReceiveOrder={receivePurchaseOrder}
          onCreateCycleCount={createCycleCount}
          onCycleCountChange={changeCycleCountValue}
          onCompleteCycleCount={completeCycleCount}
        />
      </div>
    </div>
  );
}

export default POSDashboard;
