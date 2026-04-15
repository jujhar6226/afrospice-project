import { formatMoney, getStatusTone, sanitizeText } from "./helpers";
import { getProductVisual } from "../shared/productVisuals";
import SoftPagination from "../shared/SoftPagination";

function InventoryDirectoryPanel({
  filteredProducts,
  filteredProductCount,
  stats,
  query,
  category,
  categories,
  inventoryLane,
  laneOptions,
  currentPage,
  totalPages,
  tableLoading,
  onPageChange,
  onQueryChange,
  onCategoryChange,
  onInventoryLaneChange,
  onPopulateForm,
  onQuickRestock,
  onDelete,
}) {
  const pageSize = 10;
  const pageStart = filteredProductCount ? (currentPage - 1) * pageSize + 1 : 0;
  const pageEnd = filteredProductCount ? Math.min(currentPage * pageSize, filteredProductCount) : 0;

  return (
    <section className="soft-panel inventory-directory-panel">
      <div className="panel-header soft-panel-header wrap-header">
        <div>
          <h3>Inventory Directory</h3>
          <p className="panel-subtitle">
            Search, segment, and act on the full inventory with cleaner visibility.
          </p>
        </div>
        <span className="inventory-hero-flag">
          Showing {filteredProductCount} of {stats.totalProducts}
        </span>
      </div>

      <div className="inventory-directory-toolbar">
        <input
          className="input"
          placeholder="Search name, SKU, barcode, supplier, or category"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
        />
        <select
          className="input toolbar-select"
          value={category}
          onChange={(event) => onCategoryChange(event.target.value)}
        >
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      <div className="inventory-lane-bar">
        {laneOptions.map((lane) => (
          <button
            key={lane.key}
            type="button"
            className={`inventory-lane-chip${inventoryLane === lane.key ? " active" : ""}`}
            onClick={() => onInventoryLaneChange(lane.key)}
          >
            <span>{lane.label}</span>
            <strong>{lane.count}</strong>
          </button>
        ))}
      </div>

      <div className="inventory-table-wrap table-wrap">
        {tableLoading ? (
          <div className="empty-state-card center">Refreshing inventory workspace...</div>
        ) : filteredProducts.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Supplier</th>
                <th>Category</th>
                <th>Stock</th>
                <th>Unit Price</th>
                <th>Stock Value</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => {
                const statusTone = getStatusTone(product.status);
                const visual = getProductVisual(product);

                return (
                  <tr key={product.id} className={`inventory-table-row ${product.lane}`}>
                    <td>
                      <div className="inventory-row-product">
                        <div className={`product-thumb product-thumb--${visual.tone}`}>
                          <img src={visual.image} alt={visual.alt} />
                        </div>
                        <div>
                          <div className="inventory-row-title">{product.name}</div>
                          <div className="inventory-row-subline">
                            {sanitizeText(product.sku)}
                            {product.barcode ? ` - ${sanitizeText(product.barcode)}` : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>{sanitizeText(product.supplier) || "General Supplier"}</td>
                    <td>{sanitizeText(product.category) || "General"}</td>
                    <td>{Number(product.stock || 0)}</td>
                    <td>{formatMoney(product.price)}</td>
                    <td>{formatMoney(product.stockValue)}</td>
                    <td>
                      <span className={`status-pill ${statusTone}`}>{product.status}</span>
                    </td>
                    <td>
                      <div className="table-actions">
                        <button
                          type="button"
                          className="btn btn-secondary small"
                          onClick={() => onPopulateForm(product)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-primary small"
                          onClick={() => onQuickRestock(product)}
                        >
                          Restock
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger small"
                          onClick={() => onDelete(product)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="empty-state-card center">
            No products match the current search and lane filters.
          </div>
        )}
      </div>

      {!tableLoading && filteredProductCount ? (
        <div className="inventory-directory-pagination">
          <div className="inventory-directory-pagination-copy">
            <span>
              Showing {pageStart}-{pageEnd} of {filteredProductCount}
            </span>
            <small>Use the page controls to move through the rest of the inventory list.</small>
          </div>
          <SoftPagination
            currentPage={currentPage}
            totalPages={totalPages}
            onChange={onPageChange}
            className="inventory-soft-pagination"
            label="Inventory page navigation"
          />
        </div>
      ) : null}
    </section>
  );
}

export default InventoryDirectoryPanel;
