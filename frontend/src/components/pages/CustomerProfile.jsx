import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  FaArrowLeft as FiArrowLeft,
  FaCartShopping as FiShoppingCart,
  FaEnvelope as FiMail,
  FaPercent as FiPercent,
  FaPhone as FiPhone,
  FaReceipt as FiReceipt,
  FaTrash as FiTrash,
  FaUserPlus as FiUserPlus,
  FaWallet as FiWallet,
} from "react-icons/fa6";

import API from "../../api/api";
import AssistantActionBanner from "../AssistantActionBanner";
import { ANALYTICAL_BLUE_ACCENT, ANALYTICAL_BLUE_DEEP, ANALYTICAL_BLUE_FAINT, ANALYTICAL_BLUE_MID } from "./shared/chartTheme";
import {
  formatDate,
  firstNumberFrom,
  formatMoney,
  formatPercent,
  getResponseData,
} from "./shared/dataHelpers";
import { getIdentityInitials, getIdentityTone } from "./shared/identityAvatar";

const emptyDraft = {
  name: "",
  email: "",
  phone: "",
  notes: "",
  loyaltyOptIn: true,
  marketingOptIn: false,
  preferredContactMethod: "Phone",
};

function resolvePreferredContactMethod(draft = {}) {
  const hasEmail = Boolean(String(draft?.email || "").trim());
  const hasPhone = Boolean(String(draft?.phone || "").trim());
  const current = String(draft?.preferredContactMethod || "").trim();

  if (current === "Email" && hasEmail) return "Email";
  if (current === "Phone" && hasPhone) return "Phone";
  if (current === "SMS" && hasPhone) return "SMS";

  if (hasPhone) return "Phone";
  if (hasEmail) return "Email";
  return "None";
}

function toCustomerDraft(customer = null) {
  return {
    name: String(customer?.name || ""),
    email: String(customer?.email || ""),
    phone: String(customer?.phone || ""),
    notes: String(customer?.notes || ""),
    loyaltyOptIn: Boolean(customer?.loyaltyOptIn),
    marketingOptIn: Boolean(customer?.marketingOptIn),
    preferredContactMethod: resolvePreferredContactMethod({
      email: customer?.email,
      phone: customer?.phone,
      preferredContactMethod: customer?.preferredContactMethod,
    }),
  };
}

function buildCustomerRecordPreview(baseRecord = null, draft = {}, settings = {}, preview = null) {
  const defaultDiscountPct = Number(settings?.defaultCustomerDiscountPct || 5);
  const vipDiscountPct = Number(settings?.vipCustomerDiscountPct || 10);
  const discountsEnabled = Boolean(settings?.enableDiscounts);
  const loyaltyOptIn = Boolean(draft?.loyaltyOptIn);
  const hasContactMethod = Boolean(String(draft?.email || "").trim() || String(draft?.phone || "").trim());
  const preferredContactMethod = resolvePreferredContactMethod(draft);
  const previewCustomerNumber = String(preview?.customerNumber || "").trim();
  const previewLoyaltyCardNumber = String(
    preview?.loyaltyCardNumber || preview?.loyaltyNumber || ""
  ).trim();
  const savedLoyaltyCardNumber = String(
    baseRecord?.loyaltyCardNumber || baseRecord?.loyaltyNumber || ""
  ).trim();
  const customerNumber = String(baseRecord?.customerNumber || previewCustomerNumber).trim();
  const lifetimeSpend = firstNumberFrom(baseRecord, ["lifetimeSpend"]);
  const orderCount = firstNumberFrom(baseRecord, ["orderCount"]);
  const qualifiesForVip = orderCount >= 6 || lifetimeSpend >= 350;
  const discountPercent = discountsEnabled
    ? qualifiesForVip
      ? vipDiscountPct
      : defaultDiscountPct
    : 0;
  const pendingLoyaltyCardNumber = loyaltyOptIn
    ? savedLoyaltyCardNumber || previewLoyaltyCardNumber || "Issued on save"
    : "";
  const hasSavedLoyaltyCard = Boolean(savedLoyaltyCardNumber);
  const profileCompletenessPct = Math.round(
    (
      [
        draft?.email,
        draft?.phone,
        draft?.notes,
        loyaltyOptIn ? "enrolled" : "",
      ].filter((value) => String(value || "").trim()).length /
      4
    ) * 100
  );
  const discountEligible = discountsEnabled && loyaltyOptIn && hasContactMethod;
  const loyaltyTier = loyaltyOptIn ? (qualifiesForVip ? "VIP" : "Member") : "Guest";
  const loyaltyStatus = loyaltyOptIn
    ? hasContactMethod
      ? hasSavedLoyaltyCard
        ? "Registered profile"
        : "Ready on save"
      : "Contact details needed"
    : "Enrollment needed";
  const loyaltyProgramStatus = loyaltyOptIn
    ? hasSavedLoyaltyCard
      ? discountEligible
        ? "Card active"
        : "Card issued"
      : "Ready to issue"
    : "Not enrolled";
  const discountReason = discountEligible
    ? hasSavedLoyaltyCard
      ? `${discountPercent}% loyalty pricing is available for named customer checkouts.`
      : `${discountPercent}% loyalty pricing will activate once this customer record is saved.`
    : loyaltyOptIn
      ? "Add a phone number or email to activate member pricing for future checkouts."
      : "Enroll this customer into the loyalty program to issue a card number and activate member pricing.";

  return {
    ...baseRecord,
    id: baseRecord?.id ?? null,
    name: String(draft?.name || "").trim() || "New customer",
    email: String(draft?.email || "").trim(),
    phone: String(draft?.phone || "").trim(),
    notes: String(draft?.notes || "").trim(),
    customerNumber: customerNumber || "Assigned on save",
    loyaltyNumber: pendingLoyaltyCardNumber || "Not issued",
    loyaltyCardNumber: pendingLoyaltyCardNumber,
    loyaltyTier,
    loyaltyStatus,
    discountEligible,
    discountPercent: discountEligible ? discountPercent : 0,
    discountReason,
    customerStatus: baseRecord?.customerStatus || "New",
    customerStatusTone: baseRecord?.customerStatusTone || "neutral",
    loyaltyOptIn,
    marketingOptIn: Boolean(draft?.marketingOptIn),
    preferredContactMethod,
    loyaltyEnrolledAt:
      loyaltyOptIn
        ? baseRecord?.loyaltyEnrolledAt || "Issued when saved"
        : null,
    loyaltyProgramStatus,
    orderCount,
    lifetimeSpend,
    averageOrderValue: firstNumberFrom(baseRecord, ["averageOrderValue"]),
    lastPurchaseAt: baseRecord?.lastPurchaseAt || null,
    firstPurchaseAt: baseRecord?.firstPurchaseAt || null,
    recentOrders: Array.isArray(baseRecord?.recentOrders) ? baseRecord.recentOrders : [],
    topProducts: Array.isArray(baseRecord?.topProducts) ? baseRecord.topProducts : [],
    monthlySpend: Array.isArray(baseRecord?.monthlySpend) ? baseRecord.monthlySpend : [],
    profileCompletenessPct,
    contactCoverage: {
      hasEmail: Boolean(String(draft?.email || "").trim()),
      hasPhone: Boolean(String(draft?.phone || "").trim()),
      hasNotes: Boolean(String(draft?.notes || "").trim()),
    },
    nextBestCustomerAction: loyaltyOptIn
      ? hasContactMethod
        ? hasSavedLoyaltyCard
          ? "Use the loyalty card number or customer name in checkout to apply member pricing."
          : `Save this profile to issue ${pendingLoyaltyCardNumber || "the loyalty card number"} and activate member pricing.`
        : "Capture a phone number or email before saving so the card can be used on future checkouts."
      : "Turn on loyalty enrollment if this shopper wants a reusable card number and automatic discount tracking.",
  };
}

function CustomerProfile({ settings }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { customerId } = useParams();

  const isCreateMode = customerId === "new" || location.pathname.endsWith("/customers/new");
  const currency = settings?.currency || "CAD";

  const [customer, setCustomer] = useState(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(!isCreateMode);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState(location.state?.customerNotice || "");
  const [error, setError] = useState("");
  const [enrollmentPreview, setEnrollmentPreview] = useState(null);

  const assistantActionLabel = location.state?.assistantActionLabel || "";
  const assistantActionNote = location.state?.assistantActionNote || "";

  useEffect(() => {
    if (isCreateMode) {
      setCustomer(null);
      setDraft({
        ...emptyDraft,
        ...location.state?.prefillCustomerDraft,
      });
      setLoading(false);
      setError("");
      return;
    }

    let cancelled = false;

    const loadCustomer = async () => {
      try {
        setLoading(true);
        const response = await API.get(`/customers/${customerId}`);
        if (cancelled) return;

        const nextCustomer = getResponseData(response);
        setCustomer(nextCustomer);
        setDraft(toCustomerDraft(nextCustomer));
        setError("");
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError?.message || "Could not load the customer record.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadCustomer();
    return () => {
      cancelled = true;
    };
  }, [customerId, isCreateMode, location.state]);

  useEffect(() => {
    if (!isCreateMode) {
      setEnrollmentPreview(null);
      return;
    }

    let cancelled = false;

    const loadEnrollmentPreview = async () => {
      try {
        const response = await API.get("/customers/preview/new");
        if (cancelled) return;
        setEnrollmentPreview(getResponseData(response) || null);
      } catch {
        if (!cancelled) {
          setEnrollmentPreview(null);
        }
      }
    };

    loadEnrollmentPreview();
    return () => {
      cancelled = true;
    };
  }, [isCreateMode]);

  useEffect(() => {
    const nextPreferredContactMethod = resolvePreferredContactMethod({
      email: draft.email,
      phone: draft.phone,
      preferredContactMethod: draft.preferredContactMethod,
    });
    const currentPreferredContactMethod = String(draft?.preferredContactMethod || "").trim() || "None";

    if (currentPreferredContactMethod !== nextPreferredContactMethod) {
      setDraft((current) => {
        const currentValue = String(current?.preferredContactMethod || "").trim() || "None";
        if (currentValue === nextPreferredContactMethod) {
          return current;
        }

        return {
          ...current,
          preferredContactMethod: nextPreferredContactMethod,
        };
      });
    }
  }, [draft.email, draft.phone, draft.preferredContactMethod]);

  const record = useMemo(
    () => buildCustomerRecordPreview(isCreateMode ? null : customer, draft, settings, enrollmentPreview),
    [customer, draft, enrollmentPreview, isCreateMode, settings]
  );
  const trendSeries = useMemo(
    () =>
      Array.isArray(record?.monthlySpend)
        ? record.monthlySpend.map((entry, index) => ({
            label: String(entry?.label || `P-${index + 1}`),
            revenue: firstNumberFrom(entry, ["revenue"]),
            orders: firstNumberFrom(entry, ["orders"]),
          }))
        : [],
    [record]
  );

  const summaryCards = useMemo(
    () => [
      {
        label: "Lifetime Spend",
        value: formatMoney(currency, firstNumberFrom(record, ["lifetimeSpend"])),
        note: record?.firstPurchaseAt ? `First purchase ${formatDate(record.firstPurchaseAt)}` : "No completed purchases yet",
        icon: FiWallet,
      },
      {
        label: "Total Orders",
        value: `${firstNumberFrom(record, ["orderCount"])}`,
        note: record?.lastPurchaseAt ? `Last visit ${formatDate(record.lastPurchaseAt)}` : "Awaiting first recorded visit",
        icon: FiReceipt,
      },
      {
        label: "Average Basket",
        value: formatMoney(currency, firstNumberFrom(record, ["averageOrderValue"])),
        note: `${record?.profileCompletenessPct || 0}% profile completeness`,
        icon: FiShoppingCart,
      },
      {
        label: "Discount Eligibility",
        value: record?.discountEligible ? formatPercent(record?.discountPercent || 0, 0) : "Locked",
        note: record?.discountReason || "No pricing rule is active yet.",
        icon: FiPercent,
      },
    ],
    [currency, record]
  );

  const contactStatus = [
    { label: "Email", enabled: Boolean(record?.contactCoverage?.hasEmail), icon: FiMail },
    { label: "Phone", enabled: Boolean(record?.contactCoverage?.hasPhone), icon: FiPhone },
    { label: "Notes", enabled: Boolean(record?.contactCoverage?.hasNotes), icon: FiReceipt },
  ];

  const checkoutRecognition = useMemo(
    () => [
      {
        label: "Customer number",
        value: record?.customerNumber || "Assigned when saved",
        status: record?.customerNumber ? "Live" : "Pending",
        icon: FiUserPlus,
      },
      {
        label: "Loyalty card",
        value: record?.loyaltyCardNumber || (record?.loyaltyOptIn ? "Issued on save" : "Not enrolled"),
        status: record?.loyaltyOptIn ? "Member" : "Guest",
        icon: FiWallet,
      },
      {
        label: "Phone lookup",
        value: record?.phone || "Phone not captured",
        status: record?.contactCoverage?.hasPhone ? "Ready" : "Needed",
        icon: FiPhone,
      },
      {
        label: "Email lookup",
        value: record?.email || "Email not captured",
        status: record?.contactCoverage?.hasEmail ? "Ready" : "Needed",
        icon: FiMail,
      },
    ],
    [record]
  );

  const loyaltySnapshot = useMemo(
    () => [
      {
        label: "Member tier",
        value: record?.loyaltyTier || "Guest",
      },
      {
        label: "Program status",
        value: record?.loyaltyProgramStatus || "Not enrolled",
      },
      {
        label: "Preferred contact",
        value: record?.preferredContactMethod || "Not selected",
      },
      {
        label: "Pricing rule",
        value: record?.discountEligible
          ? `${record?.discountPercent || 0}% named-customer discount is live`
          : "Discount is waiting for contact capture or enrollment",
      },
    ],
    [record]
  );

  const handleSave = async (event) => {
    event.preventDefault();
    if (saving) return;

    try {
      setSaving(true);
      setError("");
      setNotice("");

      const payload = {
        name: draft.name,
        email: draft.email || "",
        phone: draft.phone || "",
        notes: draft.notes || "",
        loyaltyOptIn: Boolean(draft.loyaltyOptIn),
        marketingOptIn: Boolean(draft.marketingOptIn),
        preferredContactMethod: resolvePreferredContactMethod(draft),
      };

      const response = isCreateMode ? await API.post("/customers", payload) : await API.put(`/customers/${customerId}`, payload);
      const savedCustomer = getResponseData(response);

      if (isCreateMode) {
        const issuedCustomerNumber = String(savedCustomer?.customerNumber || "").trim();
        const issuedLoyaltyCardNumber = String(savedCustomer?.loyaltyCardNumber || "").trim();
        const noticeParts = [`${savedCustomer.name} created successfully.`];
        if (issuedCustomerNumber) {
          noticeParts.push(`Customer ID ${issuedCustomerNumber} is live.`);
        }
        if (issuedLoyaltyCardNumber) {
          noticeParts.push(`Loyalty card ${issuedLoyaltyCardNumber} is ready for checkout.`);
        }
        navigate(`/customers/${savedCustomer.id}`, {
          replace: true,
          state: {
            customerNotice: noticeParts.join(" "),
          },
        });
        return;
      }

      setCustomer(savedCustomer);
      setDraft(toCustomerDraft(savedCustomer));
      setNotice(`${savedCustomer.name} updated successfully.`);
    } catch (requestError) {
      setError(requestError?.message || "Could not save the customer record.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!customer || saving || customer?.isWalkIn) return;
    if (!window.confirm(`Delete ${customer.name}? This cannot be undone.`)) return;

    try {
      setSaving(true);
      setError("");
      await API.delete(`/customers/${customer.id}`);
      navigate("/customers", {
        replace: true,
        state: {
          assistantActionLabel: "Customer removed",
          assistantActionNote: `${customer.name} was removed from the customer directory.`,
        },
      });
    } catch (requestError) {
      setError(requestError?.message || "Could not delete the customer record.");
      setSaving(false);
    }
  };

  const openCheckout = () => {
    const nextCustomer = String(record?.name || "").trim();
    if (!nextCustomer) return;

    navigate("/terminal", {
      state: {
        assistantActionLabel: `Checkout for ${nextCustomer}`,
        assistantActionNote: `${nextCustomer} is prefilled for the next sale so loyalty pricing can be applied in-lane.`,
        prefillCustomer: nextCustomer,
        prefillCustomerId: record?.id || null,
        openAdvancedCheckout: true,
      },
    });
  };

  return (
    <div className="page-container customer-record-page">
      <AssistantActionBanner label={assistantActionLabel} note={assistantActionNote} />
      {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}
      {notice ? <div className="info-banner">{notice}</div> : null}
      {loading ? (
        <section className="soft-panel customer-record-empty">
          <strong>Loading customer record...</strong>
          <p>Pulling the named-customer profile, loyalty status, and recent order history.</p>
        </section>
      ) : null}

      <section className="reference-page-heading customer-record-heading">
        <div className="reference-page-heading-copy">
          <span className="reference-page-kicker">Customers</span>
          <h1>{isCreateMode ? "Create customer" : record?.name || "Customer record"}</h1>
          <p>
            {isCreateMode
              ? "Create a named customer record so checkout, loyalty pricing, and visit history all tie back to one profile."
              : "Use one customer record for loyalty status, discount eligibility, visit history, and named-order activity."}
          </p>
        </div>

        <div className="reference-page-heading-actions">
          <button type="button" className="btn btn-secondary" onClick={() => navigate("/customers")}>
            <FiArrowLeft />
            Back to Customers
          </button>
          {!isCreateMode ? (
            <button type="button" className="btn btn-primary" onClick={openCheckout}>
              <FiShoppingCart />
              Start Checkout
            </button>
          ) : null}
        </div>
      </section>

      <section className="soft-panel customer-record-hero">
        <div className="customer-record-hero-main">
          <span className="reference-avatar customer-record-avatar" data-tone={getIdentityTone(record?.name, "blue")}>
            {getIdentityInitials(record?.name, "CU")}
          </span>
          <div className="customer-record-hero-copy">
            <span className="reference-page-kicker">{isCreateMode ? "New loyalty profile" : "Named customer record"}</span>
            <h2>{record?.name || "Customer record"}</h2>
            <p>{record?.discountReason || "Named customer pricing and history will appear here once the record is saved."}</p>
            <div className="customer-record-pill-row">
              <span className={`status-pill ${record?.customerStatusTone || "neutral"}`}>{record?.customerStatus || "New"}</span>
              <span className="status-pill neutral">{record?.loyaltyTier || "Guest"}</span>
              <span className={`status-pill ${record?.discountEligible ? "success" : "warning"}`}>
                {record?.discountEligible ? `${record?.discountPercent || 0}% discount live` : "Discount locked"}
              </span>
            </div>
          </div>
        </div>

        <div className="customer-record-hero-aside customer-record-loyalty-surface">
          <span className="reference-page-kicker">Loyalty card</span>
          <strong>{record?.loyaltyCardNumber || "Not issued yet"}</strong>
          <p>
            {record?.discountEligible
              ? `${record?.discountPercent || 0}% named-customer pricing is ready at checkout.`
              : record?.discountReason || "Complete enrollment and capture contact details to activate member pricing."}
          </p>
          <div className="customer-record-loyalty-grid">
            {loyaltySnapshot.map((item) => (
              <div key={item.label} className="customer-record-loyalty-metric">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="customer-record-recognition-grid">
        {checkoutRecognition.map((item) => (
          <article key={item.label} className="soft-panel customer-record-recognition-card">
            <div className="customer-record-recognition-icon">
              {item.icon ? <item.icon /> : null}
            </div>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.status}</small>
          </article>
        ))}
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

      <section className="soft-main-grid soft-main-grid--customer-record">
        <article className="soft-panel soft-form-panel customer-record-form-card">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Customer Profile</span>
              <h2>{isCreateMode ? "Create a usable customer record" : "Profile and contact capture"}</h2>
            </div>
            <span className={`status-pill ${record?.profileCompletenessPct >= 67 ? "success" : "warning"}`}>
              {record?.profileCompletenessPct || 0}% complete
            </span>
          </header>

          <form className="stack-form" onSubmit={handleSave}>
            <div className="form-two-col">
              <input
                className="input"
                value={draft.name}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder="Customer name"
              />
              <input
                className="input"
                value={draft.email}
                onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                placeholder="Email"
              />
            </div>
              <input
                className="input"
                value={draft.phone}
                onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))}
                placeholder="Phone number"
              />
            <div className="form-two-col">
              <select
                className="input"
                value={draft.preferredContactMethod}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, preferredContactMethod: event.target.value }))
                }
              >
                <option value="None">Preferred contact: None</option>
                <option value="Phone">Preferred contact: Phone</option>
                <option value="Email">Preferred contact: Email</option>
                <option value="SMS">Preferred contact: SMS</option>
              </select>
              <div className="customer-record-option-stack">
                <label className="customer-record-check">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.loyaltyOptIn)}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, loyaltyOptIn: event.target.checked }))
                    }
                  />
                  <div>
                    <strong>Issue loyalty card</strong>
                    <small>Give this customer a reusable loyalty number and member pricing eligibility.</small>
                  </div>
                </label>
                <label className="customer-record-check">
                  <input
                    type="checkbox"
                    checked={Boolean(draft.marketingOptIn)}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, marketingOptIn: event.target.checked }))
                    }
                  />
                  <div>
                    <strong>Send offers and reminders</strong>
                    <small>Allow promotional follow-up and reminder messages for this customer.</small>
                  </div>
                </label>
              </div>
            </div>
            {isCreateMode ? (
              <div className="customer-record-preview-callout">
                <span className="reference-page-kicker">Auto-issued membership numbers</span>
                <div className="customer-record-preview-grid">
                  <div className="customer-record-preview-item">
                    <span>Customer ID</span>
                    <strong>{record?.customerNumber || "Assigned on save"}</strong>
                    <small>Used by staff to find the profile quickly.</small>
                  </div>
                  <div className="customer-record-preview-item">
                    <span>Loyalty card</span>
                    <strong>
                      {draft.loyaltyOptIn
                        ? record?.loyaltyCardNumber || "Issued when saved"
                        : "Enable loyalty to issue a reusable card"}
                    </strong>
                    <small>
                      {draft.loyaltyOptIn
                        ? "Customers can use this card number on future checkouts."
                        : "Turn on loyalty enrollment to auto-issue the card."}
                    </small>
                  </div>
                </div>
              </div>
            ) : null}
            <textarea
              className="input textarea"
              rows={4}
              value={draft.notes}
              onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
              placeholder="Staff notes for this customer record"
            />
            <div className="soft-form-actions">
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? "Saving..." : isCreateMode ? "Create Customer" : "Save Changes"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  setDraft(
                    isCreateMode
                      ? {
                          ...emptyDraft,
                          ...location.state?.prefillCustomerDraft,
                        }
                      : toCustomerDraft(customer)
                  )
                }
              >
                Reset
              </button>
              {!isCreateMode ? (
                <button type="button" className="btn btn-danger" onClick={handleDelete}>
                  <FiTrash />
                  Delete
                </button>
              ) : null}
            </div>
          </form>
        </article>

        <div className="soft-side-stack">
          <article className="soft-panel customer-record-loyalty-card">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Loyalty & Discount</span>
                <h3>{record?.loyaltyTier || "Guest"} program profile</h3>
              </div>
              <span className={`status-pill ${record?.discountEligible ? "success" : "warning"}`}>
                {record?.discountEligible ? `${record?.discountPercent || 0}% live` : "Awaiting contact"}
              </span>
            </header>
            <div className="soft-key-value-list">
              <div>
                <span>Loyalty card number</span>
                <strong>{record?.loyaltyCardNumber || "Not issued"}</strong>
              </div>
              <div>
                <span>Status</span>
                <strong>{record?.loyaltyStatus || "Contact details needed"}</strong>
              </div>
              <div>
                <span>Preferred contact</span>
                <strong>{record?.preferredContactMethod || "None selected"}</strong>
              </div>
              <div>
                <span>Checkout behavior</span>
                <strong>
                  {record?.discountEligible
                    ? "This customer can receive named-customer pricing when selected in the POS."
                    : "Capture an email or phone number to make this customer eligible for named pricing."}
                </strong>
              </div>
              <div>
                <span>VIP unlock</span>
                <strong>6 orders or CAD 350 lifetime spend unlocks the VIP discount path.</strong>
              </div>
              <div>
                <span>Next best action</span>
                <strong>{record?.nextBestCustomerAction || "No follow-up guidance is available yet."}</strong>
              </div>
            </div>
          </article>

          <article className="soft-panel customer-record-loyalty-card">
            <header className="soft-panel-header">
              <div>
                <span className="reference-page-kicker">Checkout Recognition</span>
                <h3>What staff can use at the lane</h3>
              </div>
            </header>
            <div className="customer-record-contact-grid">
              {contactStatus.map((item) => (
                <article key={item.label} className="soft-list-row customer-record-contact-row">
                  <div className="customer-record-contact-copy">
                    <strong>{item.label}</strong>
                      <small>{item.enabled ? `${item.label} is captured and usable.` : `${item.label} is still missing.`}</small>
                    </div>
                    <span className={`status-pill ${item.enabled ? "success" : "warning"}`}>{item.enabled ? "Captured" : "Needed"}</span>
                  </article>
              ))}
            </div>
            <div className="customer-record-next-step">
              <span className="reference-page-kicker">Next best step</span>
              <strong>{record?.nextBestCustomerAction || "No follow-up guidance is available yet."}</strong>
            </div>
          </article>
        </div>
      </section>

      <section className="soft-section-grid soft-section-grid--two customer-record-lower">
        <article className="soft-panel customer-record-orders-card">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Recent Orders</span>
              <h3>Customer purchase history</h3>
            </div>
            {!isCreateMode ? (
              <button type="button" className="btn btn-secondary btn-compact" onClick={() => navigate("/orders", { state: { prefillOrderQuery: record?.name } })}>
                Open Orders
              </button>
            ) : null}
          </header>

          {Array.isArray(record?.recentOrders) && record.recentOrders.length ? (
            <div className="soft-list">
              {record.recentOrders.map((order) => (
                <article key={order.id} className="soft-list-row">
                  <div>
                    <strong>{order.id}</strong>
                    <small>{formatDate(order.date)} | {order.channel || order.paymentMethod || "Store order"}</small>
                  </div>
                  <div className="soft-inline-value">
                    <strong>{formatMoney(currency, order.total)}</strong>
                    <small>{order.itemCount || 0} items | {order.status || "Recorded"}</small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="customer-record-empty">
              <strong>No order history yet.</strong>
              <p>Once this customer completes named checkouts, recent orders will appear here with spend and basket history.</p>
            </div>
          )}
        </article>

        <article className="soft-panel customer-record-products-card">
          <header className="soft-panel-header">
            <div>
              <span className="reference-page-kicker">Top Products</span>
              <h3>What this customer actually buys</h3>
            </div>
          </header>

          {Array.isArray(record?.topProducts) && record.topProducts.length ? (
            <div className="soft-list">
              {record.topProducts.map((product) => (
                <article key={product.name} className="soft-list-row">
                  <div>
                    <strong>{product.name}</strong>
                    <small>{product.qty || 0} units purchased</small>
                  </div>
                  <div className="soft-inline-value">
                    <strong>{formatMoney(currency, product.revenue)}</strong>
                    <small>Lifetime demand</small>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="customer-record-empty">
              <strong>No product signal yet.</strong>
              <p>This customer needs at least one completed named order before product preference data can be profiled.</p>
            </div>
          )}
        </article>
      </section>

      <section className="soft-panel customer-record-trend-card">
        <header className="soft-panel-header">
          <div>
            <span className="reference-page-kicker">Customer Momentum</span>
            <h2>Named demand over time</h2>
          </div>
        </header>

        <div className="soft-chart-shell soft-chart-shell--short">
          {trendSeries.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trendSeries}>
                <defs>
                  <linearGradient id="customerRecordTrendFill" x1="0" y1="0" x2="0" y2="1">
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
                <Area
                  type="monotone"
                  dataKey="revenue"
                  stroke={ANALYTICAL_BLUE_DEEP}
                  fill="url(#customerRecordTrendFill)"
                  strokeWidth={2.6}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="customer-record-empty customer-record-empty--chart">
              <strong>No demand trend yet.</strong>
              <p>The monthly spend curve will appear once this customer has named orders on record.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default CustomerProfile;
