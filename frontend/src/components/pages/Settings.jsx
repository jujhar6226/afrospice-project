import { useEffect, useMemo, useState } from "react";
import {
  FaBell as FiBell,
  FaCode as FiCode,
  FaCreditCard as FiCreditCard,
  FaGear as FiSettings,
  FaLocationDot as FiMapPin,
  FaTrashCan as FiTrash2,
  FaUser as FiUser,
} from "react-icons/fa6";

const SETTINGS_SECTIONS = [
  {
    id: "general",
    label: "General",
    icon: FiSettings,
    title: "Store settings",
    description: "Store identity, operating defaults, and core workspace preferences.",
  },
  {
    id: "account",
    label: "Account",
    icon: FiUser,
    title: "Account information",
    description: "Workspace owner details, support contacts, and appearance controls.",
  },
  {
    id: "localization",
    label: "Localization",
    icon: FiMapPin,
    title: "Localization settings",
    description: "Currency, region, timezone, and the live Ontario tax posture.",
  },
  {
    id: "notifications",
    label: "Notifications",
    icon: FiBell,
    title: "Notification settings",
    description: "Operational alerts, reporting digests, and storewide notices.",
  },
  {
    id: "billing",
    label: "Billing",
    icon: FiCreditCard,
    title: "Billing information",
    description: "Subscription plan, billing controls, and customer discount policy.",
  },
  {
    id: "api",
    label: "API",
    icon: FiCode,
    title: "API workspace access",
    description: "Environment controls and connected system access for the workspace.",
  },
];

const NUMERIC_FIELDS = new Set([
  "taxRate",
  "lowStockThreshold",
  "autoLockMinutes",
  "defaultCustomerDiscountPct",
  "vipCustomerDiscountPct",
  "maxAutoDiscountPct",
]);

const BOOLEAN_FIELDS = new Set([
  "notifications",
  "autoPrintReceipt",
  "enableDiscounts",
  "requirePinForRefunds",
  "showStockWarnings",
  "salesEmailReports",
  "compactTables",
  "dashboardAnimations",
  "quickCheckout",
  "soundEffects",
  "billingAutoCharge",
  "aiDiscountSuggestions",
  "apiAccessEnabled",
]);

const CURRENCY_OPTIONS = ["CAD"];
const TIME_ZONE_OPTIONS = [
  "America/Toronto",
  "America/New_York",
  "America/Chicago",
  "America/Vancouver",
  "UTC",
];
const REPORT_VIEW_OPTIONS = ["Daily", "Weekly", "Monthly", "Quarterly", "Yearly"];
const BILLING_PLAN_OPTIONS = ["Starter", "Growth", "Premium", "Enterprise"];
const BILLING_PROVIDER_OPTIONS = ["Manual", "Stripe", "Square", "Paystack"];
const DISCOUNT_MODE_OPTIONS = ["manual", "policy", "guided"];
const AUTO_LOCK_OPTIONS = [15, 30, 45, 60, 90];

function SettingsToggle({ label, hint, checked, onChange }) {
  return (
    <label className="settings-toggle-row">
      <span className="settings-toggle-copy">
        <strong>{label}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
      <span className={`settings-toggle-pill${checked ? " is-on" : ""}`}>
        <input type="checkbox" checked={checked} onChange={onChange} />
        <span className="settings-toggle-knob" />
      </span>
    </label>
  );
}

function SettingsInfoRow({ label, value, accent }) {
  return (
    <div className={`settings-info-row${accent ? ` settings-info-row--${accent}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Settings({
  darkMode,
  setDarkMode,
  settings,
  onSaveSettings,
  settingsSaving,
  currentUser,
}) {
  const [form, setForm] = useState(settings);
  const [activeSection, setActiveSection] = useState("general");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  const identityName = currentUser?.fullName || form.managerName || "Workspace Manager";
  const identityEmail =
    currentUser?.email || form.supportEmail || form.billingContactEmail || "support@afrospice.com";
  const identityRole = currentUser?.role || "Owner";
  const identityInitials = useMemo(
    () =>
      String(identityName || "AS")
        .split(" ")
        .filter(Boolean)
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase() || "AS",
    [identityName]
  );

  const activeMeta =
    SETTINGS_SECTIONS.find((section) => section.id === activeSection) || SETTINGS_SECTIONS[0];

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const buildPatch = (fields) =>
    fields.reduce((patch, field) => {
      let value = form[field];

      if (NUMERIC_FIELDS.has(field)) {
        value = Number(value || 0);
      } else if (BOOLEAN_FIELDS.has(field)) {
        value = Boolean(value);
      } else if (field === "currency") {
        value = String(value || "").toUpperCase();
      } else {
        value = value ?? "";
      }

      patch[field] = value;
      return patch;
    }, {});

  const saveFields = async (event, fields, successMessage) => {
    event.preventDefault();
    setNotice("");
    setError("");

    try {
      const nextSettings = await onSaveSettings(buildPatch(fields));
      setForm(nextSettings);
      setNotice(successMessage);
    } catch (saveError) {
      setError(saveError?.message || "Could not save settings.");
    }
  };

  return (
    <div className={`page-container settings-reference-page settings-reference-page--${activeSection}`}>
      <section className="reference-page-heading settings-reference-heading">
        <div className="reference-page-heading-copy">
          <span className="reference-page-kicker">
            Settings &nbsp;&rsaquo;&nbsp; {activeMeta.label}
          </span>
          <h1>Settings</h1>
          <p>Manage your store settings and preferences through one clean operating surface.</p>
        </div>
      </section>

      {notice ? <div className="info-banner">{notice}</div> : null}
      {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}

      <div className="settings-reference-shell">
        <aside className="settings-reference-nav">
          <div className="settings-reference-nav-header">
            <div className="settings-reference-brand-mark" aria-hidden="true">
              <span className="brand-logo-shape brand-logo-shape-top" />
              <span className="brand-logo-shape brand-logo-shape-bottom" />
            </div>
            <div className="settings-reference-nav-copy">
              <strong>AfroSpice</strong>
              <small>Store controls</small>
            </div>
          </div>

          <div className="settings-reference-owner">
            <div className="settings-reference-owner-avatar">{identityInitials}</div>
            <div className="settings-reference-owner-copy">
              <span>Welcome,</span>
              <strong>{identityName}</strong>
            </div>
          </div>

          <nav className="settings-reference-nav-list">
            {SETTINGS_SECTIONS.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.id}
                  type="button"
                  className={
                    section.id === activeSection
                      ? "settings-reference-nav-item is-active"
                      : "settings-reference-nav-item"
                  }
                  onClick={() => setActiveSection(section.id)}
                >
                  <Icon />
                  <span>{section.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="settings-reference-content">
          <div className="settings-reference-tabs">
            {SETTINGS_SECTIONS.map((section) => (
              <button
                key={section.id}
                type="button"
                className={
                  section.id === activeSection
                    ? "settings-reference-tab is-active"
                    : "settings-reference-tab"
                }
                onClick={() => setActiveSection(section.id)}
              >
                {section.label}
              </button>
            ))}
          </div>

          {activeSection === "general" ? (
            <div className="settings-section-stack">
              <form
                className="settings-surface-card"
                onSubmit={(event) =>
                  saveFields(
                    event,
                    ["storeName", "domain", "branchCode", "lowStockThreshold", "receiptFooter"],
                    "Store settings saved."
                  )
                }
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>Store settings</h3>
                    <p>Store identity, domain handling, and core retail defaults.</p>
                  </div>
                </div>

                <div className="stack-form">
                  <label>
                    <span className="field-label">Store name</span>
                    <input
                      className="input"
                      value={form.storeName || ""}
                      onChange={(event) => updateField("storeName", event.target.value)}
                    />
                  </label>

                  <div className="form-two-col">
                    <label>
                      <span className="field-label">Domain</span>
                      <input
                        className="input"
                        value={form.domain || ""}
                        onChange={(event) => updateField("domain", event.target.value)}
                      />
                    </label>

                    <label>
                      <span className="field-label">Branch code</span>
                      <input
                        className="input"
                        value={form.branchCode || ""}
                        onChange={(event) => updateField("branchCode", event.target.value)}
                      />
                    </label>
                  </div>

                  <div className="form-two-col">
                    <label>
                      <span className="field-label">Low-stock threshold</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        value={form.lowStockThreshold ?? 10}
                        onChange={(event) => updateField("lowStockThreshold", event.target.value)}
                      />
                    </label>

                    <label>
                      <span className="field-label">Receipt footer</span>
                      <input
                        className="input"
                        value={form.receiptFooter || ""}
                        onChange={(event) => updateField("receiptFooter", event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>

              <form
                className="settings-surface-card"
                onSubmit={(event) =>
                  saveFields(
                    event,
                    ["defaultReportsView", "autoLockMinutes", "compactTables", "dashboardAnimations"],
                    "Workspace preferences saved."
                  )
                }
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>Preferences</h3>
                    <p>Set how the workspace behaves day to day for operations and reporting.</p>
                  </div>
                </div>

                <div className="stack-form">
                  <div className="form-two-col">
                    <label>
                      <span className="field-label">Default reports view</span>
                      <select
                        className="toolbar-select"
                        value={form.defaultReportsView || "Monthly"}
                        onChange={(event) => updateField("defaultReportsView", event.target.value)}
                      >
                        {REPORT_VIEW_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span className="field-label">Auto-lock after inactivity</span>
                      <select
                        className="toolbar-select"
                        value={form.autoLockMinutes ?? 30}
                        onChange={(event) => updateField("autoLockMinutes", event.target.value)}
                      >
                        {AUTO_LOCK_OPTIONS.map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {minutes} Minutes
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="settings-toggle-list">
                    <SettingsToggle
                      label="Compact tables"
                      hint="Reduce row density in long operational tables."
                      checked={Boolean(form.compactTables)}
                      onChange={(event) => updateField("compactTables", event.target.checked)}
                    />
                    <SettingsToggle
                      label="Dashboard animations"
                      hint="Keep live charts and transitions active in the workspace."
                      checked={Boolean(form.dashboardAnimations)}
                      onChange={(event) => updateField("dashboardAnimations", event.target.checked)}
                    />
                  </div>
                </div>

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>

              <section className="settings-surface-card settings-surface-card--billing-note">
                <div className="settings-surface-head">
                  <div>
                    <h3>Billing information</h3>
                    <p>Keep plan posture and renewal timing visible from the main settings surface.</p>
                  </div>
                </div>

                <div className="settings-billing-hero">
                  <div>
                    <span className="field-label">Current plan</span>
                    <strong>{form.billingPlan || "Premium"}</strong>
                    <small>
                      Next billing date {form.billingNextBillingDate || "not scheduled"} via{" "}
                      {form.billingProvider || "Manual"}.
                    </small>
                  </div>
                  <button type="button" className="btn btn-secondary">
                    Manage Subscription
                  </button>
                </div>
              </section>

              <section className="settings-surface-card settings-surface-card--danger">
                <div className="settings-surface-head">
                  <div>
                    <h3>Delete store</h3>
                    <p>This workspace is protected. Store deletion should stay behind managed support.</p>
                  </div>
                </div>

                <div className="settings-danger-strip">
                  <div className="settings-danger-icon">
                    <FiTrash2 />
                  </div>
                  <div className="settings-danger-copy">
                    <strong>Delete Store</strong>
                    <small>This would permanently remove the account and all associated retail data.</small>
                  </div>
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "account" ? (
            <div className="settings-section-stack">
              <form
                className="settings-surface-card"
                onSubmit={(event) =>
                  saveFields(
                    event,
                    ["managerName", "supportEmail", "supportPhone"],
                    "Account details saved."
                  )
                }
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>Account information</h3>
                    <p>Workspace owner identity and support contacts across the retail system.</p>
                  </div>
                </div>

                <div className="settings-account-block">
                  <div className="settings-account-identity">
                    <div className="settings-account-avatar">{identityInitials}</div>
                    <div className="settings-account-copy">
                      <strong>{identityName}</strong>
                      <span>{identityEmail}</span>
                      <small>{identityRole}</small>
                    </div>
                  </div>

                  <div className="stack-form">
                    <label>
                      <span className="field-label">Manager name</span>
                      <input
                        className="input"
                        value={form.managerName || ""}
                        onChange={(event) => updateField("managerName", event.target.value)}
                      />
                    </label>

                    <label>
                      <span className="field-label">Support email</span>
                      <input
                        className="input"
                        type="email"
                        value={form.supportEmail || ""}
                        onChange={(event) => updateField("supportEmail", event.target.value)}
                      />
                    </label>

                    <label>
                      <span className="field-label">Support phone</span>
                      <input
                        className="input"
                        value={form.supportPhone || ""}
                        onChange={(event) => updateField("supportPhone", event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>

              <form
                className="settings-surface-card"
                onSubmit={(event) =>
                  saveFields(
                    event,
                    ["quickCheckout", "soundEffects", "requirePinForRefunds"],
                    "Workspace account controls saved."
                  )
                }
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>Workspace controls</h3>
                    <p>Security and operator experience settings for the live retail floor.</p>
                  </div>
                </div>

                <div className="settings-toggle-list">
                  <SettingsToggle
                    label="Quick checkout"
                    hint="Keep the faster checkout flow active for cashiers."
                    checked={Boolean(form.quickCheckout)}
                    onChange={(event) => updateField("quickCheckout", event.target.checked)}
                  />
                  <SettingsToggle
                    label="Sound effects"
                    hint="Play small confirmation sounds on key operator actions."
                    checked={Boolean(form.soundEffects)}
                    onChange={(event) => updateField("soundEffects", event.target.checked)}
                  />
                  <SettingsToggle
                    label="Require PIN for refunds"
                    hint="Keep refund approvals behind secure cashier confirmation."
                    checked={Boolean(form.requirePinForRefunds)}
                    onChange={(event) => updateField("requirePinForRefunds", event.target.checked)}
                  />
                  <SettingsToggle
                    label="Use dark mode"
                    hint="Theme applies instantly on this device and stays local to the workspace session."
                    checked={Boolean(darkMode)}
                    onChange={(event) => setDarkMode(Boolean(event.target.checked))}
                  />
                </div>

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {activeSection === "localization" ? (
            <div className="settings-section-stack">
              <form
                className="settings-surface-card"
                onSubmit={(event) =>
                  saveFields(
                    event,
                    ["currency", "timeZone", "taxRate"],
                    "Localization settings saved."
                  )
                }
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>Localization settings</h3>
                    <p>Regional defaults for Kitchener, Ontario, currency, and tax handling.</p>
                  </div>
                </div>

                <div className="stack-form">
                  <label>
                    <span className="field-label">Currency</span>
                    <select
                      className="toolbar-select"
                      value={form.currency || "CAD"}
                      onChange={(event) => updateField("currency", event.target.value)}
                    >
                      {CURRENCY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="form-two-col">
                    <label>
                      <span className="field-label">Time zone</span>
                      <select
                        className="toolbar-select"
                        value={form.timeZone || "America/Toronto"}
                        onChange={(event) => updateField("timeZone", event.target.value)}
                      >
                        {TIME_ZONE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span className="field-label">Tax rate for taxable items</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.taxRate ?? 13}
                        onChange={(event) => updateField("taxRate", event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>

              <section className="settings-surface-card">
                <div className="settings-surface-head">
                  <div>
                    <h3>Ontario grocery tax posture</h3>
                    <p>The workspace now uses product-level tax classes instead of one flat grocery tax.</p>
                  </div>
                </div>

                <div className="settings-info-grid">
                  <SettingsInfoRow label="Basic groceries" value="0% zero-rated" accent="success" />
                  <SettingsInfoRow label="Taxable prepared/snack items" value="13% HST" accent="brand" />
                  <SettingsInfoRow label="Store region" value="Kitchener, Ontario, Canada" />
                  <SettingsInfoRow label="Tax engine" value="Product-by-product" />
                </div>
              </section>
            </div>
          ) : null}

          {activeSection === "notifications" ? (
            <form
              className="settings-surface-card settings-surface-card--wide"
              onSubmit={(event) =>
                saveFields(
                  event,
                  ["notifications", "autoPrintReceipt", "showStockWarnings", "salesEmailReports"],
                  "Notification settings saved."
                )
              }
            >
              <div className="settings-surface-head">
                <div>
                  <h3>Notification settings</h3>
                  <p>Visibility for orders, inventory alerts, and storewide reporting digests.</p>
                </div>
              </div>

              <div className="settings-notification-groups">
                <div className="settings-notification-group">
                  <h4>Orders</h4>
                  <SettingsToggle
                    label="New order alerts"
                    hint="Keep order notifications active in the live workspace."
                    checked={Boolean(form.notifications)}
                    onChange={(event) => updateField("notifications", event.target.checked)}
                  />
                  <SettingsToggle
                    label="Order updates"
                    hint="Push important order-state updates to the workspace team."
                    checked={Boolean(form.autoPrintReceipt)}
                    onChange={(event) => updateField("autoPrintReceipt", event.target.checked)}
                  />
                </div>

                <div className="settings-notification-group">
                  <h4>Inventory</h4>
                  <SettingsToggle
                    label="Low-stock alerts"
                    hint="Warn the store when watched lines fall below threshold."
                    checked={Boolean(form.showStockWarnings)}
                    onChange={(event) => updateField("showStockWarnings", event.target.checked)}
                  />
                </div>

                <div className="settings-notification-group">
                  <h4>General</h4>
                  <SettingsToggle
                    label="Email daily summaries"
                    hint="Send daily reporting digests to the workspace contact."
                    checked={Boolean(form.salesEmailReports)}
                    onChange={(event) => updateField("salesEmailReports", event.target.checked)}
                  />
                </div>
              </div>

              <div className="settings-actions-row">
                <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                  {settingsSaving ? "Saving..." : "Save Changes"}
                </button>
              </div>
            </form>
          ) : null}

          {activeSection === "billing" ? (
            <div className="settings-section-stack">
              <section className="settings-surface-card">
                <div className="settings-surface-head">
                  <div>
                    <h3>Billing information</h3>
                    <p>Plan posture, billing timing, and the commercial controls for the workspace.</p>
                  </div>
                </div>

                <div className="settings-billing-hero">
                  <div>
                    <span className="field-label">Current plan</span>
                    <strong>{form.billingPlan || "Premium"}</strong>
                    <small>
                      Next billing date {form.billingNextBillingDate || "not scheduled"} via{" "}
                      {form.billingProvider || "Manual"}.
                    </small>
                  </div>
                  <button type="button" className="btn btn-secondary">
                    Manage Subscription
                  </button>
                </div>
              </section>

              <form
                className="settings-surface-card"
                onSubmit={(event) =>
                  saveFields(
                    event,
                    [
                      "billingPlan",
                      "billingProvider",
                      "billingContactEmail",
                      "billingNextBillingDate",
                      "billingAutoCharge",
                    ],
                    "Billing settings saved."
                  )
                }
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>Billing settings</h3>
                    <p>Plan controls, billing provider, and automatic renewal preferences.</p>
                  </div>
                </div>

                <div className="stack-form">
                  <div className="form-two-col">
                    <label>
                      <span className="field-label">Billing plan</span>
                      <select
                        className="toolbar-select"
                        value={form.billingPlan || "Premium"}
                        onChange={(event) => updateField("billingPlan", event.target.value)}
                      >
                        {BILLING_PLAN_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span className="field-label">Billing provider</span>
                      <select
                        className="toolbar-select"
                        value={form.billingProvider || "Manual"}
                        onChange={(event) => updateField("billingProvider", event.target.value)}
                      >
                        {BILLING_PROVIDER_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="form-two-col">
                    <label>
                      <span className="field-label">Billing contact email</span>
                      <input
                        className="input"
                        type="email"
                        value={form.billingContactEmail || ""}
                        onChange={(event) => updateField("billingContactEmail", event.target.value)}
                      />
                    </label>

                    <label>
                      <span className="field-label">Next billing date</span>
                      <input
                        className="input"
                        type="date"
                        value={form.billingNextBillingDate || ""}
                        onChange={(event) => updateField("billingNextBillingDate", event.target.value)}
                      />
                    </label>
                  </div>

                  <div className="settings-toggle-list">
                    <SettingsToggle
                      label="Automatic renewal"
                      hint="Charge the stored billing provider automatically on the next cycle."
                      checked={Boolean(form.billingAutoCharge)}
                      onChange={(event) => updateField("billingAutoCharge", event.target.checked)}
                    />
                  </div>
                </div>

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>

              <form
                className="settings-surface-card"
                onSubmit={(event) =>
                  saveFields(
                    event,
                    [
                      "enableDiscounts",
                      "customerDiscountMode",
                      "defaultCustomerDiscountPct",
                      "vipCustomerDiscountPct",
                      "maxAutoDiscountPct",
                      "aiDiscountSuggestions",
                    ],
                    "Customer discount policy saved."
                  )
                }
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>Customer discount policy</h3>
                    <p>Guide cashier discounts with a real policy instead of ad hoc overrides.</p>
                  </div>
                </div>

                <div className="stack-form">
                  <div className="settings-toggle-list">
                    <SettingsToggle
                      label="Enable discounts"
                      hint="Allow discounts to be applied at checkout and in customer workflows."
                      checked={Boolean(form.enableDiscounts)}
                      onChange={(event) => updateField("enableDiscounts", event.target.checked)}
                    />
                    <SettingsToggle
                      label="AI discount suggestions"
                      hint="Use demand and customer history to suggest safe discount ranges."
                      checked={Boolean(form.aiDiscountSuggestions)}
                      onChange={(event) => updateField("aiDiscountSuggestions", event.target.checked)}
                    />
                  </div>

                  <div className="form-two-col">
                    <label>
                      <span className="field-label">Discount mode</span>
                      <select
                        className="toolbar-select"
                        value={form.customerDiscountMode || "guided"}
                        onChange={(event) => updateField("customerDiscountMode", event.target.value)}
                      >
                        {DISCOUNT_MODE_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label>
                      <span className="field-label">Default customer discount %</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={form.defaultCustomerDiscountPct ?? 0}
                        onChange={(event) =>
                          updateField("defaultCustomerDiscountPct", event.target.value)
                        }
                      />
                    </label>
                  </div>

                  <div className="form-two-col">
                    <label>
                      <span className="field-label">VIP customer discount %</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={form.vipCustomerDiscountPct ?? 0}
                        onChange={(event) =>
                          updateField("vipCustomerDiscountPct", event.target.value)
                        }
                      />
                    </label>

                    <label>
                      <span className="field-label">Maximum automatic discount %</span>
                      <input
                        className="input"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={form.maxAutoDiscountPct ?? 0}
                        onChange={(event) => updateField("maxAutoDiscountPct", event.target.value)}
                      />
                    </label>
                  </div>
                </div>

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          ) : null}

          {activeSection === "api" ? (
            <div className="settings-section-stack">
              <form
                className="settings-surface-card"
                onSubmit={(event) =>
                  saveFields(
                    event,
                    ["apiAccessEnabled", "apiEnvironmentLabel"],
                    "API access settings saved."
                  )
                }
              >
                <div className="settings-surface-head">
                  <div>
                    <h3>API key management</h3>
                    <p>Control connected access to the live AfroSpice workspace and operating data.</p>
                  </div>
                </div>

                <div className="stack-form">
                  <label>
                    <span className="field-label">Environment label</span>
                    <input
                      className="input"
                      value={form.apiEnvironmentLabel || ""}
                      onChange={(event) => updateField("apiEnvironmentLabel", event.target.value)}
                    />
                  </label>

                  <div className="settings-toggle-list">
                    <SettingsToggle
                      label="Enable API workspace access"
                      hint="Allow connected systems to use the live operational API layer."
                      checked={Boolean(form.apiAccessEnabled)}
                      onChange={(event) => updateField("apiAccessEnabled", event.target.checked)}
                    />
                  </div>
                </div>

                <div className="settings-actions-row">
                  <button type="submit" className="btn btn-primary" disabled={settingsSaving}>
                    {settingsSaving ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>

              <section className="settings-surface-card">
                <div className="settings-surface-head">
                  <div>
                    <h3>Connected system view</h3>
                    <p>Reference details for branch, billing, and support wiring in the live workspace.</p>
                  </div>
                </div>

                <div className="settings-info-grid">
                  <SettingsInfoRow label="Domain" value={form.domain || "afrospice.com"} />
                  <SettingsInfoRow label="Branch" value={form.branchCode || "AFR-MAIN-001"} />
                  <SettingsInfoRow label="Billing provider" value={form.billingProvider || "Manual"} />
                  <SettingsInfoRow label="Support email" value={form.supportEmail || "support@afrospice.com"} />
                </div>
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default Settings;
