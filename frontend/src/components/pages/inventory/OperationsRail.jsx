import {
  formatDateTime,
  formatMoney,
  getMovementLabel,
  getPurchaseOrderTone,
} from "./helpers";

function OperationsRail({
  actionBusy,
  purchaseOrderStats,
  activeCycleCount,
  cycleCountStats,
  operationsTab,
  onSetOperationsTab,
  opsLoading,
  purchaseOrders,
  movements,
  cycleCounts,
  cycleCountValues,
  onBackupExport,
  onPurchaseOrderStatus,
  onReceiveOrder,
  onCreateCycleCount,
  onCycleCountChange,
  onCompleteCycleCount,
}) {
  const activeCountItems = Array.isArray(activeCycleCount?.items)
    ? activeCycleCount.items
    : [];
  const completedCounts = cycleCounts.filter((count) => count.status !== "Open").slice(0, 2);

  return (
    <section className="soft-panel inventory-operations-rail">
      <div className="panel-header soft-panel-header wrap-header">
        <div>
          <h3>Operations Rail</h3>
          <p className="panel-subtitle">
            Purchasing, receiving, movement history, and cycle-count execution without leaving inventory.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary small"
          onClick={onBackupExport}
          disabled={actionBusy === "backup"}
        >
          {actionBusy === "backup" ? "Opening..." : "Backup in Settings"}
        </button>
      </div>

      <div className="inventory-summary-strip compact">
        <article className="inventory-mini-stat">
          <span>Open Orders</span>
          <strong>{purchaseOrderStats.open}</strong>
          <small>{purchaseOrderStats.drafts} still in draft.</small>
        </article>
        <article className="inventory-mini-stat">
          <span>Inbound Units</span>
          <strong>{purchaseOrderStats.inboundUnits}</strong>
          <small>Units not yet received.</small>
        </article>
        <article className="inventory-mini-stat">
          <span>Open Count</span>
          <strong>{activeCycleCount ? activeCycleCount.id : "None"}</strong>
          <small>
            {activeCycleCount
              ? `${activeCycleCount.linesCount} lines waiting for verification.`
              : `${cycleCountStats.recentVariance} variance units across recent completed counts.`}
          </small>
        </article>
      </div>

      <div className="inventory-ops-tabs">
        <button
          type="button"
          className={`inventory-ops-tab${operationsTab === "orders" ? " active" : ""}`}
          onClick={() => onSetOperationsTab("orders")}
        >
          Purchase Orders
        </button>
        <button
          type="button"
          className={`inventory-ops-tab${operationsTab === "movements" ? " active" : ""}`}
          onClick={() => onSetOperationsTab("movements")}
        >
          Movement Feed
        </button>
        <button
          type="button"
          className={`inventory-ops-tab${operationsTab === "counts" ? " active" : ""}`}
          onClick={() => onSetOperationsTab("counts")}
        >
          Cycle Counts
        </button>
      </div>

      {operationsTab === "orders" ? (
        opsLoading ? (
          <div className="empty-state-card center compact">Loading purchasing workflow...</div>
        ) : purchaseOrders.length ? (
          <div className="inventory-po-list">
            {purchaseOrders.map((order) => (
              <article key={order.id} className="inventory-po-card">
                <div className="inventory-po-topline">
                  <div>
                    <strong>{order.supplier}</strong>
                    <p>
                      {order.id} - {formatDateTime(order.createdAt)}
                    </p>
                  </div>
                  <span className={`status-pill ${getPurchaseOrderTone(order.status)}`}>
                    {order.status}
                  </span>
                </div>

                <div className="inventory-po-metrics">
                  <span>{order.linesCount} lines</span>
                  <span>{order.openUnits} open units</span>
                  <span>{formatMoney(order.totalEstimatedCost)}</span>
                </div>

                <div className="inventory-po-actions">
                  {order.status === "Draft" ? (
                    <button
                      type="button"
                      className="btn btn-secondary small"
                      onClick={() => onPurchaseOrderStatus(order.id, "Sent")}
                      disabled={actionBusy === `status-${order.id}`}
                    >
                      {actionBusy === `status-${order.id}` ? "Saving..." : "Mark Sent"}
                    </button>
                  ) : null}
                  {["Draft", "Sent", "Partially Received"].includes(order.status) ? (
                    <button
                      type="button"
                      className="btn btn-primary small"
                      onClick={() => onReceiveOrder(order.id)}
                      disabled={actionBusy === `receive-${order.id}`}
                    >
                      {actionBusy === `receive-${order.id}` ? "Receiving..." : "Receive All"}
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state-card center compact">
            No purchase orders yet. Select reorder lines and create supplier drafts from the planner.
          </div>
        )
      ) : operationsTab === "movements" ? (
        movements.length ? (
          <div className="inventory-movement-list">
            {movements.map((movement) => (
              <article key={movement.id} className="inventory-movement-item">
                <div className="inventory-movement-copy">
                  <strong>{movement.productName}</strong>
                  <p>
                    {getMovementLabel(movement.movementType)} -{" "}
                    {movement.note || movement.referenceId || "Inventory event"}
                  </p>
                </div>
                <div className="inventory-movement-meta">
                  <span
                    className={`movement-delta ${
                      movement.quantityDelta >= 0 ? "positive" : "negative"
                    }`}
                  >
                    {movement.quantityDelta >= 0 ? "+" : ""}
                    {movement.quantityDelta}
                  </span>
                  <small>{formatDateTime(movement.createdAt)}</small>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state-card center compact">
            Movement history starts with your next stock adjustment, restock, sale, or receiving event.
          </div>
        )
      ) : (
        <div className="inventory-count-panel">
          <div className="inventory-count-toolbar">
            <button
              type="button"
              className="btn btn-primary small"
              onClick={onCreateCycleCount}
              disabled={actionBusy === "create-count"}
            >
              {actionBusy === "create-count" ? "Starting..." : "Start Quick Count"}
            </button>
            <span className="inventory-hero-flag">{cycleCounts.length} recent counts</span>
          </div>

          {activeCycleCount ? (
            <div className="inventory-count-active">
              <div className="inventory-count-headline">
                <strong>{activeCycleCount.id}</strong>
                <p>
                  Created {formatDateTime(activeCycleCount.createdAt)} for {activeCycleCount.linesCount} lines.
                </p>
              </div>

              <div className="inventory-count-item-list">
                {activeCountItems.map((item) => (
                  <div key={item.id} className="inventory-count-item">
                    <div className="inventory-count-copy">
                      <strong>{item.productName}</strong>
                      <small>Expected {item.expectedQty} units</small>
                    </div>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      className="input inventory-count-input"
                      value={cycleCountValues[item.productId] ?? item.expectedQty ?? 0}
                      onChange={(event) => onCycleCountChange(item.productId, event.target.value)}
                    />
                  </div>
                ))}
              </div>

              <div className="inventory-count-actions">
                <button
                  type="button"
                  className="btn btn-primary small"
                  onClick={() => onCompleteCycleCount(activeCycleCount)}
                  disabled={actionBusy === `count-${activeCycleCount.id}`}
                >
                  {actionBusy === `count-${activeCycleCount.id}` ? "Applying..." : "Apply Count"}
                </button>
              </div>
            </div>
          ) : (
            <div className="empty-state-card center compact">
              No active cycle count. Start a quick count from the current priority set.
            </div>
          )}

          {completedCounts.length ? (
            <div className="inventory-count-history">
              {completedCounts.map((count) => (
                <article key={count.id} className="inventory-count-history-card">
                  <div>
                    <strong>{count.id}</strong>
                    <p>{formatDateTime(count.completedAt || count.createdAt)}</p>
                  </div>
                  <div className="inventory-count-history-meta">
                    <span>{count.varianceLines} variance lines</span>
                    <span>{count.varianceUnits} units shifted</span>
                  </div>
                </article>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

export default OperationsRail;
