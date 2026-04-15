function CommandDockPanel({
  editingId,
  scanRef,
  scanValue,
  formData,
  loading,
  onScanValueChange,
  onScanSubmit,
  onChange,
  onSubmit,
  onReset,
  operationsRail,
}) {
  return (
    <div className="soft-panel soft-panel--compact inventory-command-panel">
      <div className="panel-header soft-panel-header">
        <div>
          <h3>Command Dock</h3>
          <p className="panel-subtitle">
            Scan a code, edit an existing SKU, or register a new line cleanly.
          </p>
        </div>
        <span className={`status-pill ${editingId ? "warning" : "success"}`}>
          {editingId ? "Editing" : "Ready"}
        </span>
      </div>

      <form className="stack-form inventory-scan-form" onSubmit={onScanSubmit}>
        <label className="field-label inventory-dock-field inventory-dock-field--wide">
          <span>Scanner Dock</span>
          <div className="inventory-scan-row">
            <input
              ref={scanRef}
              className="input inventory-scan-input"
              placeholder="Scan barcode or enter SKU"
              value={scanValue}
              onChange={(event) => onScanValueChange(event.target.value)}
            />
            <button type="submit" className="btn btn-primary">
              Load
            </button>
          </div>
        </label>
      </form>

      <div className="inventory-command-note">
        Scan to pull an existing SKU into the dock. No match means the dock is ready
        to register a new product immediately.
      </div>

      <div className="inventory-form-divider" />
      <form className="stack-form inventory-dock-form" onSubmit={onSubmit}>
        <div className="inventory-dock-grid">
          <label className="field-label inventory-dock-field inventory-dock-field--wide">
            <span>Product name</span>
            <input
              name="name"
              className="input"
              placeholder="Product name"
              value={formData.name}
              onChange={onChange}
            />
          </label>

          <label className="field-label inventory-dock-field">
            <span>SKU</span>
            <input
              name="sku"
              className="input"
              placeholder="SKU"
              value={formData.sku}
              onChange={onChange}
            />
          </label>

          <label className="field-label inventory-dock-field">
            <span>Barcode</span>
            <input
              name="barcode"
              className="input"
              placeholder="Barcode"
              value={formData.barcode}
              onChange={onChange}
            />
          </label>

          <label className="field-label inventory-dock-field">
            <span>Category</span>
            <input
              name="category"
              className="input"
              placeholder="Category"
              value={formData.category}
              onChange={onChange}
            />
          </label>

          <label className="field-label inventory-dock-field inventory-dock-field--wide">
            <span>Supplier</span>
            <input
              name="supplier"
              className="input"
              placeholder="Supplier"
              value={formData.supplier}
              onChange={onChange}
            />
          </label>
        </div>

        <div className="inventory-dock-metrics">
          <label className="field-label inventory-dock-field">
            <span>Unit price</span>
            <input
              name="price"
              type="number"
              min="0"
              step="0.01"
              className="input"
              placeholder="Unit price"
              value={formData.price}
              onChange={onChange}
            />
          </label>

          <label className="field-label inventory-dock-field">
            <span>Unit cost</span>
            <input
              name="unitCost"
              type="number"
              min="0"
              step="0.01"
              className="input"
              placeholder="Unit cost"
              value={formData.unitCost}
              onChange={onChange}
            />
          </label>

          <label className="field-label inventory-dock-field">
            <span>Stock quantity</span>
            <input
              name="stock"
              type="number"
              min="0"
              step="1"
              className="input"
              placeholder="Stock quantity"
              value={formData.stock}
              onChange={onChange}
            />
          </label>
        </div>

        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={loading}>
            {loading ? "Saving..." : editingId ? "Save Changes" : "Add Product"}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onReset}>
            Reset Dock
          </button>
        </div>
      </form>

      <div className="inventory-form-divider" />
      {operationsRail}
    </div>
  );
}

export default CommandDockPanel;
