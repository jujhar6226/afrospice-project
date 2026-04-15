import {
  formatMoney,
  formatRelativeTime,
  getStatusTone,
  sanitizeText,
} from "./helpers";

function ReorderPlannerPanel({
  priorityQueue,
  selectedDraftIds,
  selectedDraftItemsLength,
  draftUnits,
  dormantValue,
  dormantCount,
  actionBusy,
  onSelectAll,
  onCreatePurchaseOrders,
  onExportDraft,
  onToggleDraftSelection,
  onPopulateForm,
  onQuickRestock,
  getRecommendedQty,
  liveNow,
}) {
  return (
    <div className="soft-panel inventory-reorder-panel">
      <div className="panel-header soft-panel-header wrap-header">
        <div>
          <h3>Reorder Planner</h3>
          <p className="panel-subtitle">
            Priority purchase draft built from stock pressure, sell-through, and
            dormant stock signals.
          </p>
        </div>

        <div className="toolbar-actions">
          <button type="button" className="btn btn-secondary small" onClick={onSelectAll}>
            {selectedDraftIds.length === priorityQueue.length && priorityQueue.length
              ? "Clear Draft"
              : "Select All"}
          </button>
          <button
            type="button"
            className="btn btn-secondary small"
            onClick={onCreatePurchaseOrders}
            disabled={!selectedDraftItemsLength || actionBusy === "create-po"}
          >
            {actionBusy === "create-po" ? "Creating..." : "Create Orders"}
          </button>
          <button type="button" className="btn btn-primary small" onClick={onExportDraft}>
            Export Draft
          </button>
        </div>
      </div>

      <div className="inventory-summary-strip inventory-reorder-summary">
        <article className="inventory-mini-stat">
          <span>Draft Lines</span>
          <strong>{selectedDraftItemsLength}</strong>
          <small>Selected replenishment lines.</small>
        </article>
        <article className="inventory-mini-stat">
          <span>Draft Quantity</span>
          <strong>{draftUnits}</strong>
          <small>Suggested units to buy.</small>
        </article>
        <article className="inventory-mini-stat">
          <span>Dormant Capital</span>
          <strong>{formatMoney(dormantValue)}</strong>
          <small>{dormantCount} lines are not moving.</small>
        </article>
      </div>

      {priorityQueue.length ? (
        <div className="inventory-reorder-list">
          {priorityQueue.map((item) => {
            const selected = selectedDraftIds.includes(Number(item.id));
            const recommendedQty = getRecommendedQty(item);
            const statusTone = getStatusTone(item.status);
            const needsImmediateAction =
              Number(item.stock || 0) <= 5 || String(item.status) === "Critical";

            return (
              <article
                key={item.id}
                className={`inventory-reorder-item${selected ? " selected" : ""}${
                  needsImmediateAction ? " hot" : ""
                }`}
              >
                <label className="inventory-reorder-check">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => onToggleDraftSelection(item.id)}
                  />
                  <span />
                </label>

                <div className="inventory-reorder-main">
                  <strong>{item.name}</strong>
                  <p>
                    {sanitizeText(item.category) || "General"} -{" "}
                    {sanitizeText(item.supplier) || "General Supplier"}
                  </p>
                  <div className="inventory-row-note">
                    Last sale - {formatRelativeTime(item.lastSoldAt, liveNow)}
                  </div>
                </div>

                <div className="inventory-reorder-meta">
                  <span className={`status-pill ${statusTone}`}>{item.status}</span>
                  <strong>{Number(item.stock || 0)} units</strong>
                  <small>
                    Cover -{" "}
                    {item.estimatedDaysCover
                      ? `${item.estimatedDaysCover} days`
                      : "Unknown"}
                  </small>
                </div>

                <div className="inventory-reorder-actions">
                  <div>
                    <div className="inventory-recommend-number">{recommendedQty}</div>
                    <small>Suggested reorder qty</small>
                  </div>
                  <div className="table-actions">
                    <button
                      type="button"
                      className="btn btn-secondary small"
                      onClick={() => onPopulateForm(item)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary small"
                      onClick={() => onQuickRestock(item)}
                    >
                      Restock
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state-card center inventory-reorder-empty">
          No urgent reorder lines right now. The store is in a healthy stock position.
        </div>
      )}
    </div>
  );
}

export default ReorderPlannerPanel;
