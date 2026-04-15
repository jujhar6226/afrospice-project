function buildVisiblePages(totalPages, currentPage) {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const pages = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) {
    pages.push("start-ellipsis");
  }

  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }

  if (end < totalPages - 1) {
    pages.push("end-ellipsis");
  }

  pages.push(totalPages);
  return pages;
}

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

function SoftPagination({
  currentPage,
  totalPages,
  onChange,
  className = "",
  label = "Page navigation",
}) {
  if (totalPages <= 1) return null;

  const pages = buildVisiblePages(totalPages, currentPage);

  return (
    <div className={joinClassNames("soft-pagination", className)} aria-label={label}>
      <div className="soft-pagination-meta">
        <span>Page</span>
        <strong>
          {currentPage} of {totalPages}
        </strong>
      </div>

      <div className="soft-pagination-controls">
        <button
          type="button"
          className="soft-pagination-btn"
          onClick={() => onChange(Math.max(1, currentPage - 1))}
          disabled={currentPage === 1}
        >
          Prev
        </button>

        {pages.map((page) =>
          typeof page === "number" ? (
            <button
              key={page}
              type="button"
              className={page === currentPage ? "soft-pagination-page is-active" : "soft-pagination-page"}
              onClick={() => onChange(page)}
              aria-current={page === currentPage ? "page" : undefined}
            >
              {page}
            </button>
          ) : (
            <span key={page} className="soft-pagination-ellipsis" aria-hidden="true">
              ...
            </span>
          )
        )}

        <button
          type="button"
          className="soft-pagination-btn"
          onClick={() => onChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage === totalPages}
        >
          Next
        </button>
      </div>
    </div>
  );
}

export default SoftPagination;
