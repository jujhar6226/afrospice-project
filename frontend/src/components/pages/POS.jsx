import { startTransition, useDeferredValue, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  FaAddressCard as FiAddressCard,
  FaBasketShopping as FiShoppingBag,
  FaBoxArchive as FiPackage,
  FaChartLine as FiActivity,
  FaDollarSign as FiDollarSign,
  FaUserPlus as FiUserPlus,
} from "react-icons/fa6";

import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import {
  ANALYTICAL_BLUE_ACCENT,
  ANALYTICAL_BLUE_DEEP,
  ANALYTICAL_BLUE_FAINT,
} from "./shared/chartTheme";
import { formatDate, formatMoney, getResponseData, toArray, toNumber } from "./shared/dataHelpers";
import { getProductVisual } from "./shared/productVisuals";

function normalizeProducts(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.products)) return payload.products;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function normalizeSales(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.sales)) return payload.sales;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function normalizeCustomers(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.customers)) return payload.customers;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function isWalkInCustomerLabel(value = "") {
  return String(value || "").trim().toLowerCase() === "walk-in customer";
}

function customerMatchesTerm(customer = {}, term = "") {
  const normalizedTerm = String(term || "").trim().toLowerCase();
  if (!normalizedTerm) return false;

  return [
    customer?.name,
    customer?.customerNumber,
    customer?.loyaltyNumber,
    customer?.loyaltyCardNumber,
    customer?.email,
    customer?.phone,
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalizedTerm);
}

function PosCatalogCardPremium({ product, currency, onAdd }) {
  const visual = getProductVisual(product);
  const taxRate = toNumber(product?.taxRate);
  const taxLabel = String(product?.taxLabel || (taxRate > 0 ? "Ontario HST" : "Basic grocery"));

  return (
    <button
      type="button"
      className="pos-ref-card"
      onClick={() => onAdd(product)}
      disabled={toNumber(product?.stock) <= 0}
    >
      <div className={`pos-ref-card-media pos-ref-card-media--${visual.tone}`}>
        <img src={visual.image} alt={visual.alt} />
      </div>
      <div className="pos-ref-card-copy">
        <strong>{product?.name || "Unnamed product"}</strong>
        <small>{product?.category || product?.sku || "General"}</small>
      </div>
      <div className="pos-ref-card-tax-row">
        <span className={`pos-ref-tax-chip${taxRate > 0 ? " is-taxable" : " is-zero-rated"}`}>
          {taxRate > 0 ? `${taxRate}% HST` : "0% grocery"}
        </span>
        <small className="pos-ref-card-tax-label">{taxLabel}</small>
      </div>
      <div className="pos-ref-card-meta">
        <span>{formatMoney(currency, product?.price)}</span>
        <em>Stock {toNumber(product?.stock)}</em>
      </div>
    </button>
  );
}

function PosCartRowPremium({
  line,
  currency,
  customerDiscountPercent = 0,
  onIncrease,
  onDecrease,
  onRemove,
}) {
  const taxRate = toNumber(line?.taxRate);
  const taxLabel = String(line?.taxLabel || (taxRate > 0 ? "Taxable item" : "Zero-rated grocery"));
  const lineBaseSubtotal = Number((toNumber(line?.price) * toNumber(line?.qty)).toFixed(2));
  const discountAmount = Number(((lineBaseSubtotal * customerDiscountPercent) / 100).toFixed(2));
  const lineSubtotal = Number((lineBaseSubtotal - discountAmount).toFixed(2));
  const lineTax = Number(((lineSubtotal * taxRate) / 100).toFixed(2));
  const lineGrossTotal = Number((lineSubtotal + lineTax).toFixed(2));

  return (
    <article className="pos-ref-order-row">
      <div className="pos-ref-order-copy">
        <strong>{line.name}</strong>
        <div className="pos-ref-order-meta">
          <small>{line.sku || "No SKU"}</small>
          <span className={`pos-ref-tax-chip${taxRate > 0 ? " is-taxable" : " is-zero-rated"}`}>
            {taxRate > 0 ? `${taxRate}% HST` : "0% grocery"}
          </span>
        </div>
        <small className="pos-ref-order-tax">
          {taxLabel}
          {" - "}
          {taxRate > 0 ? "taxable in Ontario" : "zero-rated in Ontario"}
        </small>
      </div>

      <div className="pos-ref-order-tools">
        <div className="pos-ref-qty-stepper">
          <button type="button" onClick={onDecrease} aria-label={`Decrease ${line.name}`}>
            -
          </button>
          <span>{line.qty}</span>
          <button type="button" onClick={onIncrease} aria-label={`Increase ${line.name}`}>
            +
          </button>
        </div>
        <div className="pos-ref-order-value">
          <strong>{formatMoney(currency, lineSubtotal)}</strong>
          {discountAmount > 0 ? (
            <small>{`- ${formatMoney(currency, discountAmount)} loyalty`}</small>
          ) : null}
          <small>{lineTax > 0 ? `+ ${formatMoney(currency, lineTax)} HST` : "0% HST"}</small>
          <small className="pos-ref-order-gross">{formatMoney(currency, lineGrossTotal)} gross</small>
        </div>
        <button type="button" className="pos-ref-remove" onClick={onRemove}>
          Remove
        </button>
      </div>
    </article>
  );
}

function POS({ settings, mode = "terminal" }) {
  const location = useLocation();
  const navigate = useNavigate();
  const isCreateOrderMode = mode === "createOrder" || location.pathname === "/orders/new";
  const [products, setProducts] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [recentSales, setRecentSales] = useState([]);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [cart, setCart] = useState([]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastSale, setLastSale] = useState(null);
  const [checkout, setCheckout] = useState({
    customer: "Walk-in Customer",
    customerId: null,
    paymentMethod: "Card",
    channel: "In-Store",
    status: "Paid",
  });

  const deferredQuery = useDeferredValue(query);
  const currency = settings?.currency || "CAD";
  const assistantActionLabel = location.state?.assistantActionLabel || "";
  const assistantActionNote = location.state?.assistantActionNote || "";

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        const [productsResponse, salesResponse, customersResponse] = await Promise.all([
          API.get("/products"),
          API.get("/sales"),
          API.get("/customers"),
        ]);

        if (cancelled) return;

        startTransition(() => {
          setProducts(normalizeProducts(getResponseData(productsResponse)));
          setRecentSales(normalizeSales(getResponseData(salesResponse)).slice(0, 16));
          setCustomers(normalizeCustomers(getResponseData(customersResponse)));
          setError("");
        });
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError?.message || "Could not load POS data.");
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
  }, []);

  useEffect(() => {
    const routeState = location.state || {};
    if (Object.prototype.hasOwnProperty.call(routeState, "prefillCustomer")) {
      setCheckout((current) => ({
        ...current,
        customer: String(routeState.prefillCustomer || "Walk-in Customer"),
        customerId: routeState.prefillCustomerId ? Number(routeState.prefillCustomerId) : null,
      }));
    }

    if (routeState.openAdvancedCheckout) {
      setAdvancedOpen(true);
    }
  }, [location.key, location.state]);

  const categories = useMemo(() => {
    const all = new Set(["All"]);
    for (const product of products) {
      if (product?.category) all.add(String(product.category));
    }
    return [...all];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const term = String(deferredQuery || "").trim().toLowerCase();
    return products.filter((product) => {
      if (category !== "All" && String(product?.category || "") !== category) return false;
      if (!term) return true;

      return [product?.name, product?.sku, product?.barcode].some((field) =>
        String(field || "")
          .toLowerCase()
          .includes(term)
      );
    });
  }, [products, deferredQuery, category]);

  const catalogPreview = filteredProducts.slice(0, 24);
  const normalizedCustomerQuery = String(checkout.customer || "").trim().toLowerCase();
  const normalizedCustomerSearchValue = String(checkout.customer || "").trim();
  const selectedCustomer = useMemo(() => {
    if (checkout.customerId) {
      return customers.find((customer) => Number(customer?.id) === Number(checkout.customerId)) || null;
    }

    if (!normalizedCustomerQuery || isWalkInCustomerLabel(checkout.customer)) {
      return null;
    }

    return (
      customers.find((customer) =>
        [
          customer?.name,
          customer?.customerNumber,
          customer?.loyaltyNumber,
          customer?.loyaltyCardNumber,
          customer?.email,
          customer?.phone,
        ]
          .map((value) => String(value || "").trim().toLowerCase())
          .filter(Boolean)
          .includes(normalizedCustomerQuery)
      ) || null
    );
  }, [checkout.customer, checkout.customerId, customers, normalizedCustomerQuery]);

  const customerSuggestions = useMemo(() => {
    if (!normalizedCustomerQuery || isWalkInCustomerLabel(checkout.customer)) {
      return [];
    }

    if (
      selectedCustomer &&
      String(selectedCustomer?.name || "").trim().toLowerCase() === normalizedCustomerQuery
    ) {
      return [];
    }

    return customers
      .filter((customer) => !customer?.isWalkIn && customerMatchesTerm(customer, normalizedCustomerQuery))
      .slice(0, 5);
  }, [checkout.customer, customers, normalizedCustomerQuery, selectedCustomer]);

  const canCreateCustomerRecord = Boolean(
    normalizedCustomerQuery &&
      !isWalkInCustomerLabel(checkout.customer) &&
      !selectedCustomer &&
      !customerSuggestions.length
  );
  const activeCustomerDiscountPercent =
    selectedCustomer && selectedCustomer?.discountEligible ? toNumber(selectedCustomer?.discountPercent) : 0;

  const estimatedBaseSubtotal = useMemo(
    () => cart.reduce((sum, line) => sum + toNumber(line?.price) * toNumber(line?.qty), 0),
    [cart]
  );
  const estimatedDiscount = useMemo(
    () => Number(((estimatedBaseSubtotal * activeCustomerDiscountPercent) / 100).toFixed(2)),
    [activeCustomerDiscountPercent, estimatedBaseSubtotal]
  );
  const estimatedSubtotal = Number((estimatedBaseSubtotal - estimatedDiscount).toFixed(2));
  const estimatedTax = useMemo(
    () =>
      Number(
        cart
          .reduce(
            (sum, line) =>
              sum +
              ((toNumber(line?.price) * toNumber(line?.qty) -
                (toNumber(line?.price) * toNumber(line?.qty) * activeCustomerDiscountPercent) / 100) *
                toNumber(line?.taxRate)) /
                100,
            0
          )
          .toFixed(2)
      ),
    [activeCustomerDiscountPercent, cart]
  );
  const estimatedTotal = estimatedSubtotal + estimatedTax;
  const taxSummary = useMemo(() => {
    const taxableLines = cart.filter((line) => toNumber(line?.taxRate) > 0);
    const zeroRatedLines = cart.filter((line) => toNumber(line?.taxRate) <= 0);
    const taxableSubtotal = taxableLines.reduce(
      (sum, line) => sum + toNumber(line?.price) * toNumber(line?.qty),
      0
    );
    const zeroRatedSubtotal = zeroRatedLines.reduce(
      (sum, line) => sum + toNumber(line?.price) * toNumber(line?.qty),
      0
    );

    return {
      taxableLines: taxableLines.length,
      zeroRatedLines: zeroRatedLines.length,
      taxableSubtotal: Number(taxableSubtotal.toFixed(2)),
      zeroRatedSubtotal: Number(zeroRatedSubtotal.toFixed(2)),
      estimatedDiscount,
      taxablePreviewNames: taxableLines
        .slice(0, 3)
        .map((line) => String(line?.name || "").trim())
        .filter(Boolean),
      zeroRatedPreviewNames: zeroRatedLines
        .slice(0, 3)
        .map((line) => String(line?.name || "").trim())
        .filter(Boolean),
    };
  }, [cart, estimatedDiscount]);
  const taxSummaryCopy = useMemo(() => {
    if (!cart.length) {
      return "Tax updates automatically as soon as items are added to the ticket.";
    }

    if (!taxSummary.taxableLines) {
      return `This ticket is currently all zero-rated grocery items in Ontario, so HST is ${formatMoney(
        currency,
        0
      )}${estimatedDiscount > 0 ? ` after a ${activeCustomerDiscountPercent}% loyalty discount.` : "."}`;
    }

    if (!taxSummary.zeroRatedLines) {
      return `${taxSummary.taxableLines} taxable line${
        taxSummary.taxableLines === 1 ? "" : "s"
      } are applying Ontario HST to ${formatMoney(currency, taxSummary.taxableSubtotal)}${
        estimatedDiscount > 0 ? ` after a ${activeCustomerDiscountPercent}% loyalty discount` : ""
      }.`;
    }

    return `${taxSummary.taxableLines} taxable line${
      taxSummary.taxableLines === 1 ? "" : "s"
    } are applying Ontario HST to ${formatMoney(
      currency,
      taxSummary.taxableSubtotal
    )}, while ${taxSummary.zeroRatedLines} grocery line${
      taxSummary.zeroRatedLines === 1 ? "" : "s"
    } stay zero-rated${estimatedDiscount > 0 ? ` after a ${activeCustomerDiscountPercent}% loyalty discount` : ""}.`;
  }, [activeCustomerDiscountPercent, cart.length, currency, estimatedDiscount, taxSummary]);
  const taxSummaryExamples = useMemo(() => {
    if (!cart.length) return "";

    if (!taxSummary.taxableLines) {
      return taxSummary.zeroRatedPreviewNames.length
        ? `Current zero-rated items: ${taxSummary.zeroRatedPreviewNames.join(", ")}.`
        : "";
    }

    if (!taxSummary.zeroRatedLines) {
      return taxSummary.taxablePreviewNames.length
        ? `Current taxable items: ${taxSummary.taxablePreviewNames.join(", ")}.`
        : "";
    }

    const taxableLabel = taxSummary.taxablePreviewNames.length
      ? `Taxable: ${taxSummary.taxablePreviewNames.join(", ")}.`
      : "";
    const zeroRatedLabel = taxSummary.zeroRatedPreviewNames.length
      ? ` Zero-rated: ${taxSummary.zeroRatedPreviewNames.join(", ")}.`
      : "";

    return `${taxableLabel}${zeroRatedLabel}`.trim();
  }, [cart.length, taxSummary]);
  const basketTaxMode = useMemo(() => {
    if (!cart.length) return "No items";
    if (activeCustomerDiscountPercent > 0 && !taxSummary.taxableLines) return "Discounted grocery basket";
    if (activeCustomerDiscountPercent > 0 && !taxSummary.zeroRatedLines) return "Discounted taxable basket";
    if (activeCustomerDiscountPercent > 0) return "Discounted mixed basket";
    if (!taxSummary.taxableLines) return "Zero-rated groceries";
    if (!taxSummary.zeroRatedLines) return "Taxable basket";
    return "Mixed basket";
  }, [
    activeCustomerDiscountPercent,
    cart.length,
    taxSummary.taxableLines,
    taxSummary.zeroRatedLines,
  ]);
  const taxLineLabel = useMemo(() => {
    if (!cart.length) return "Ontario HST";
    if (!taxSummary.taxableLines) return "Ontario HST (0% grocery basket)";
    if (!taxSummary.zeroRatedLines) return "Ontario HST (taxable items)";
    return "Ontario HST (mixed basket)";
  }, [cart.length, taxSummary.taxableLines, taxSummary.zeroRatedLines]);

  const latestTicket = lastSale || recentSales[0] || null;
  const paidTicketCount = recentSales.filter((sale) => String(sale?.status || "").toLowerCase() === "paid").length;
  const recentCapturedRevenue = recentSales.reduce((sum, sale) => {
    if (String(sale?.status || "").toLowerCase() !== "paid") return sum;
    return sum + toNumber(sale?.total);
  }, 0);
  const averageTicketValue = paidTicketCount > 0 ? recentCapturedRevenue / paidTicketCount : 0;

  const recentTicketTrend = useMemo(
    () =>
      recentSales
        .slice()
        .reverse()
        .slice(-10)
        .map((sale, index) => ({
          label: sale?.id || `T-${index + 1}`,
          total: toNumber(sale?.total),
        })),
    [recentSales]
  );

  const summaryCards = [
    {
      label: "Visible Products",
      value: `${filteredProducts.length}`,
      note: `${catalogPreview.length} in the current checkout view`,
      icon: FiPackage,
    },
    {
      label: "Paid Tickets",
      value: `${paidTicketCount}`,
      note: `${formatMoney(currency, recentCapturedRevenue)} captured in recent checkout flow`,
      icon: FiShoppingBag,
    },
    {
      label: "Average Ticket",
      value: formatMoney(currency, averageTicketValue),
      note: latestTicket?.id ? `Latest ticket ${latestTicket.id}` : "No ticket posted yet",
      icon: FiActivity,
    },
    {
      label: "Current Basket",
      value: formatMoney(currency, estimatedTotal),
      note: `${cart.length} live lines in the active order summary`,
      icon: FiDollarSign,
    },
  ];

  const pageKicker = isCreateOrderMode ? "Order creation" : "Checkout workspace";
  const pageTitle = isCreateOrderMode ? "Create order" : "POS";
  const pageDescription = isCreateOrderMode
    ? "Build a new order with the live catalog, loyalty pricing, and tax controls used at checkout."
    : "Sell faster with a cleaner catalog, clearer basket flow, and backend-authoritative settlement.";
  const summaryKicker = isCreateOrderMode ? "Order draft" : "Order summary";
  const summaryTitle = isCreateOrderMode ? "New order" : "Current ticket";
  const summaryBadge = isCreateOrderMode ? "Draft order" : latestTicket?.id || "No ticket yet";
  const inventoryButtonLabel = isCreateOrderMode ? "Inventory workspace" : "Open Inventory";
  const ordersButtonLabel = isCreateOrderMode ? "Back to Orders" : "Open Orders";
  const advancedButtonLabel = isCreateOrderMode
    ? advancedOpen
      ? "Hide Order Tools"
      : "Order Controls"
    : advancedOpen
      ? "Hide Advanced"
      : "Advanced Checkout";

  const updateLineQty = (productId, nextQty) => {
    setCart((current) => {
      const quantity = Math.max(1, Math.floor(toNumber(nextQty, 1)));
      return current.map((line) =>
        Number(line.productId) === Number(productId)
          ? {
              ...line,
              qty: quantity,
            }
          : line
      );
    });
  };

  const addProductToCart = (product) => {
    const productId = toNumber(product?.id, 0);
    if (!productId) return;

    setCart((current) => {
      const existing = current.find((line) => Number(line.productId) === productId);
      if (existing) {
        return current.map((line) =>
          Number(line.productId) === productId
            ? {
                ...line,
                qty: line.qty + 1,
              }
            : line
        );
      }

      return [
        ...current,
        {
          productId,
          name: String(product?.name || "Unnamed product"),
          sku: String(product?.sku || ""),
          price: toNumber(product?.price),
          taxClass: String(product?.taxClass || ""),
          taxLabel: String(product?.taxLabel || ""),
          taxRate: toNumber(product?.taxRate),
          qty: 1,
        },
      ];
    });
  };

  const removeCartLine = (productId) => {
    setCart((current) => current.filter((line) => Number(line.productId) !== Number(productId)));
  };

  const submitSale = async () => {
    if (!cart.length || submitting) return;

    try {
      setSubmitting(true);
      setError("");
      setNotice("");

      const payload = {
        items: cart.map((line) => ({
          productId: line.productId,
          qty: Math.max(1, Math.floor(toNumber(line.qty, 1))),
        })),
        customerId: selectedCustomer?.id ?? checkout.customerId ?? null,
        customer: selectedCustomer?.name || checkout.customer || "Walk-in Customer",
        paymentMethod: checkout.paymentMethod,
        channel: checkout.channel,
        status: checkout.status,
      };

      const response = await API.post("/sales", payload);
      const sale = getResponseData(response) || {};
      setLastSale(sale);
      setCart([]);
      setNotice(`Sale ${sale?.id || ""} posted successfully.`);

      const [productsResponse, salesResponse] = await Promise.all([API.get("/products"), API.get("/sales")]);
      startTransition(() => {
        setProducts(normalizeProducts(getResponseData(productsResponse)));
        setRecentSales(normalizeSales(getResponseData(salesResponse)).slice(0, 16));
      });
    } catch (submitError) {
      setError(submitError?.message || "Could not post sale.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-container pos-terminal-page pos-reference-page">
      <AssistantActionBanner label={assistantActionLabel} note={assistantActionNote} />
      {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}
      {notice ? <div className="info-banner">{notice}</div> : null}

        <section className="reference-page-heading pos-reference-heading">
          <div className="reference-page-heading-copy">
            <span className="reference-page-kicker">{pageKicker}</span>
            <h1>{pageTitle}</h1>
            <p>{pageDescription}</p>
          </div>

          <div className="pos-reference-heading-actions">
            <button type="button" className="btn btn-secondary" onClick={() => navigate("/pos-dashboard")}>
              {inventoryButtonLabel}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate("/orders")}>
              {ordersButtonLabel}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setAdvancedOpen((open) => !open)}>
              {advancedButtonLabel}
            </button>
          </div>
        </section>

      <section className="pos-reference-stat-strip">
        {summaryCards.map((card) => (
          <article key={card.label} className="pos-reference-stat">
            <div className="reference-stat-head">
              <div className="reference-stat-icon">{card.icon ? <card.icon /> : null}</div>
            </div>
            <span>{card.label}</span>
            <strong>{card.value}</strong>
            <small>{card.note}</small>
          </article>
        ))}
      </section>

      <section className="pos-reference-shell">
        <div className="pos-reference-catalog">
          <div className="pos-reference-searchbar">
            <input
              className="input pos-reference-search"
              type="text"
              placeholder="Search products, SKU, or barcode"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>

          <div className="pos-reference-tabs">
            {categories.map((option) => (
              <button
                key={option}
                type="button"
                className={`pos-reference-tab${category === option ? " active" : ""}`}
                onClick={() => setCategory(option)}
              >
                {option}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="dashboard-ref-panel pos-reference-loading">
              <p className="subtle">Loading products...</p>
            </div>
          ) : (
            <div className="pos-reference-grid">
              {catalogPreview.map((product) => (
                <PosCatalogCardPremium
                  key={product.id}
                  product={product}
                  currency={currency}
                  onAdd={addProductToCart}
                />
              ))}
            </div>
          )}
        </div>

        <aside className="pos-reference-summary">
          <div className="pos-reference-summary-head">
            <div>
              <span className="reference-page-kicker">{summaryKicker}</span>
              <h2>{summaryTitle}</h2>
            </div>
            <div className="pos-reference-summary-status">
              <span className="status-pill small neutral">{summaryBadge}</span>
              <span
                className={`pos-ref-tax-chip${
                  taxSummary.taxableLines ? " is-taxable" : " is-zero-rated"
                }`}
              >
                {basketTaxMode}
              </span>
            </div>
          </div>

          <div className="pos-reference-summary-fields">
            <div className="pos-reference-customer-field">
              <input
                className="input"
                type="text"
                placeholder="Find or add customer"
                value={checkout.customer}
                onChange={(event) =>
                  setCheckout((state) => ({
                    ...state,
                    customer: event.target.value,
                    customerId:
                      state.customerId &&
                      String(state.customer || "").trim() !== String(event.target.value || "").trim()
                        ? null
                        : state.customerId,
                  }))
                }
              />

              {selectedCustomer ? (
                <div className="pos-reference-customer-record">
                  <div className="pos-reference-customer-record-main">
                    <div>
                      <strong>{selectedCustomer.name}</strong>
                      <small>
                        {selectedCustomer.customerNumber || "No customer number"} |{" "}
                        {selectedCustomer.loyaltyNumber || "No loyalty number"}
                      </small>
                    </div>
                    <div className="pos-reference-customer-badges">
                      <span className="status-pill neutral">{selectedCustomer.loyaltyTier || "Guest"}</span>
                      <span
                        className={`status-pill ${
                          selectedCustomer.discountEligible ? "success" : "warning"
                        }`}
                      >
                        {selectedCustomer.discountEligible
                          ? `${selectedCustomer.discountPercent || 0}% live`
                          : "Discount locked"}
                      </span>
                    </div>
                  </div>
                  <div className="pos-reference-customer-record-meta">
                    <small>
                      {selectedCustomer.phone || selectedCustomer.email || "No contact recorded"} |{" "}
                      {selectedCustomer.loyaltyStatus || "Profile status unavailable"}
                    </small>
                    <div className="pos-reference-customer-record-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        onClick={() => navigate(`/customers/${selectedCustomer.id}`)}
                      >
                        <FiAddressCard />
                        View record
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-compact"
                        onClick={() =>
                          setCheckout((state) => ({
                            ...state,
                            customer: "Walk-in Customer",
                            customerId: null,
                          }))
                        }
                      >
                        Walk-in
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {!selectedCustomer && customerSuggestions.length ? (
                <div className="pos-reference-customer-suggestions">
                  {customerSuggestions.map((customer) => (
                    <button
                      key={customer.id}
                      type="button"
                      className="pos-reference-customer-suggestion"
                      onClick={() =>
                        setCheckout((state) => ({
                          ...state,
                          customer: customer.name,
                          customerId: customer.id,
                        }))
                      }
                    >
                      <div>
                        <strong>{customer.name}</strong>
                        <small>
                          {customer.customerNumber || "No number"} |{" "}
                          {customer.phone || customer.email || "No contact recorded"}
                        </small>
                      </div>
                      <span
                        className={`status-pill small ${
                          customer.discountEligible ? "success" : "neutral"
                        }`}
                      >
                        {customer.discountEligible
                          ? `${customer.discountPercent || 0}% ${customer.loyaltyTier || "Member"}`
                          : customer.loyaltyTier || "Guest"}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {canCreateCustomerRecord ? (
                <div className="pos-reference-customer-create">
                  <small>No saved customer matches this entry yet.</small>
                  <button
                    type="button"
                    className="btn btn-secondary btn-compact"
                    onClick={() =>
                      navigate("/customers/new", {
                        state: {
                          prefillCustomerDraft: {
                            name: checkout.customer,
                            loyaltyOptIn: true,
                            preferredContactMethod:
                              normalizedCustomerSearchValue.includes("@") ? "Email" : "Phone",
                            email: normalizedCustomerSearchValue.includes("@") ? normalizedCustomerSearchValue : "",
                            phone:
                              !normalizedCustomerSearchValue.includes("@") &&
                              /[0-9()+\-\s]{7,}/.test(normalizedCustomerSearchValue)
                                ? normalizedCustomerSearchValue
                                : "",
                          },
                          assistantActionLabel: "Create customer profile",
                          assistantActionNote:
                            "Capture this shopper now so future checkouts can apply loyalty pricing and named history.",
                        },
                      })
                    }
                  >
                    <FiUserPlus />
                    Create loyalty customer
                  </button>
                </div>
              ) : null}
            </div>

            {advancedOpen ? (
              <div id="pos-advanced-checkout" className="pos-reference-advanced-grid">
                <select
                  className="input"
                  value={checkout.paymentMethod}
                  onChange={(event) => setCheckout((state) => ({ ...state, paymentMethod: event.target.value }))}
                >
                  <option>Card</option>
                  <option>Cash</option>
                  <option>Transfer</option>
                  <option>Mobile Money</option>
                  <option>Other</option>
                </select>
                <select
                  className="input"
                  value={checkout.channel}
                  onChange={(event) => setCheckout((state) => ({ ...state, channel: event.target.value }))}
                >
                  <option>In-Store</option>
                  <option>Online</option>
                  <option>Delivery</option>
                  <option>Pickup</option>
                </select>
                <select
                  className="input pos-reference-advanced-grid__full"
                  value={checkout.status}
                  onChange={(event) => setCheckout((state) => ({ ...state, status: event.target.value }))}
                >
                  <option>Paid</option>
                  <option>Pending</option>
                </select>
              </div>
            ) : null}
          </div>

          <div className="pos-reference-order-list">
            {cart.length ? (
              cart.map((line) => (
                <PosCartRowPremium
                  key={line.productId}
                  line={line}
                  currency={currency}
                  customerDiscountPercent={activeCustomerDiscountPercent}
                  onIncrease={() => updateLineQty(line.productId, line.qty + 1)}
                  onDecrease={() =>
                    line.qty <= 1 ? removeCartLine(line.productId) : updateLineQty(line.productId, line.qty - 1)
                  }
                  onRemove={() => removeCartLine(line.productId)}
                />
              ))
            ) : (
              <div className="pos-reference-empty">
                <strong>Start with the catalog.</strong>
                <p>Add products from the live backend catalog to build the next sale.</p>
              </div>
            )}
          </div>

            <div className="pos-reference-totals">
              {estimatedDiscount > 0 ? (
                <div>
                  <span>Loyalty discount</span>
                  <strong>-{formatMoney(currency, estimatedDiscount)}</strong>
                </div>
              ) : null}
              <div>
                <span>Subtotal</span>
                <strong>{formatMoney(currency, estimatedSubtotal)}</strong>
              </div>
              <div>
                <span>{taxLineLabel}</span>
                <strong>{formatMoney(currency, estimatedTax)}</strong>
              </div>
            <div>
              <span>Tax mode</span>
              <strong>{basketTaxMode}</strong>
            </div>
            <div className="is-total">
              <span>Total</span>
              <strong>{formatMoney(currency, estimatedTotal)}</strong>
            </div>
          </div>

          <div
            className={`pos-reference-tax-callout${
              taxSummary.taxableLines ? " is-taxable" : " is-zero-rated"
            }`}
          >
            <strong>
              {taxSummary.taxableLines
                ? `${formatMoney(currency, taxSummary.taxableSubtotal)} taxable subtotal`
                : "Zero-rated grocery basket"}
            </strong>
            <small>{taxSummaryCopy}</small>
            {taxSummaryExamples ? <small className="pos-reference-tax-example">{taxSummaryExamples}</small> : null}
          </div>

          <button
            type="button"
            className="btn btn-primary btn-full pos-reference-submit"
            onClick={submitSale}
            disabled={!cart.length || submitting}
          >
            {submitting ? "Posting Sale..." : "Collect Payment"}
          </button>

          <button type="button" className="btn btn-secondary btn-full" onClick={() => setCart([])} disabled={!cart.length}>
            Cancel Order
          </button>
        </aside>
      </section>

      <section className="pos-reference-insights">
        <article className="dashboard-ref-panel">
          <header className="dashboard-ref-panel-head">
            <div>
              <span className="dashboard-ref-panel-kicker">Ticket flow</span>
              <h3>Recent captured revenue</h3>
            </div>
            <span className="status-pill small neutral">{paidTicketCount} paid tickets</span>
          </header>

          <div className="dashboard-ref-chart-shell dashboard-ref-chart-shell--compact">
            {recentTicketTrend.length ? (
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={recentTicketTrend}>
                  <defs>
                    <linearGradient id="posTicketTrendFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ANALYTICAL_BLUE_ACCENT} stopOpacity="0.34" />
                      <stop offset="56%" stopColor={ANALYTICAL_BLUE_DEEP} stopOpacity="0.14" />
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
                      color: "var(--text-primary)",
                    }}
                    formatter={(value) => formatMoney(currency, value)}
                  />
                  <Area
                    type="monotone"
                    dataKey="total"
                    stroke={ANALYTICAL_BLUE_DEEP}
                    fill="url(#posTicketTrendFill)"
                    strokeWidth={2.4}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <p className="subtle">No recent ticket trend is available yet.</p>
            )}
          </div>
        </article>

        <article className="dashboard-ref-panel">
          <header className="dashboard-ref-panel-head">
            <div>
              <span className="dashboard-ref-panel-kicker">Latest receipts</span>
              <h3>Live order feed</h3>
            </div>
            <span className="status-pill small neutral">{formatMoney(currency, averageTicketValue)} avg</span>
          </header>

          <div className="dashboard-ref-list">
            {toArray(recentSales).length ? (
              recentSales.slice(0, 6).map((sale) => (
                <article key={sale?.id || `${sale?.date}`} className="dashboard-ref-decision-row">
                  <div>
                    <strong>{sale?.id || "No ID"}</strong>
                    <small>{sale?.cashier || "Unknown cashier"} / {formatDate(sale?.date || sale?.createdAt)}</small>
                  </div>
                  <span className="status-pill small neutral">{formatMoney(currency, sale?.total)}</span>
                </article>
              ))
            ) : (
              <p className="subtle">No recent tickets yet.</p>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}

export default POS;

