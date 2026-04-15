import { useEffect, useMemo, useRef, useState } from "react";
import {
  FaArrowUpRightFromSquare as FiArrowUpRight,
  FaClock as FiClock,
  FaMagnifyingGlass as FiSearch,
  FaTurnDown as FiCornerDownLeft,
} from "react-icons/fa6";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

function buildSections(query, recentItems, items) {
  if (query.trim()) {
    return items.length
      ? [
          {
            key: "results",
            label: "Results",
            items,
          },
        ]
      : [];
  }

  return [
    recentItems.length
      ? {
          key: "recent",
          label: "Recent",
          items: recentItems,
        }
      : null,
    items.length
      ? {
          key: "workspace",
          label: "Workspace",
          items,
        }
      : null,
  ].filter(Boolean);
}

function GlobalCommandPalette({
  open,
  query,
  onQueryChange,
  onClose,
  onSelect,
  recentItems = [],
  items = [],
}) {
  const inputRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const sections = useMemo(() => buildSections(query, recentItems, items), [items, query, recentItems]);
  const flatItems = useMemo(() => sections.flatMap((section) => section.items), [sections]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 24);

    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (!flatItems.length) return;

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % flatItems.length);
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) => (current - 1 + flatItems.length) % flatItems.length);
      }

      if (event.key === "Enter") {
        event.preventDefault();
        const item = flatItems[activeIndex];
        if (item) onSelect(item);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, flatItems, onClose, onSelect, open]);

  if (!open) return null;

  let absoluteIndex = -1;

  return (
    <div className="command-palette-backdrop" onClick={onClose}>
      <section className="command-palette" onClick={(event) => event.stopPropagation()}>
        <div className="command-palette-search">
          <span className="command-palette-search-icon">
            <FiSearch />
          </span>
          <input
            ref={inputRef}
            className="command-palette-input"
            type="text"
            value={query}
            onChange={(event) => {
              setActiveIndex(0);
              onQueryChange(event.target.value);
            }}
            placeholder="Search workspace pages, actions, and tools"
          />
          <span className="command-palette-kbd">Esc</span>
        </div>

        <div className="command-palette-body">
          {sections.length ? (
            sections.map((section) => (
              <div key={section.key} className="command-palette-section">
                <div className="command-palette-section-label">{section.label}</div>
                <div className="command-palette-results">
                  {section.items.map((item) => {
                    absoluteIndex += 1;
                    const isActive = absoluteIndex === activeIndex;

                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={joinClassNames(
                          "command-palette-item",
                          isActive ? "is-active" : "",
                          item.danger ? "is-danger" : "",
                          item.tone ? `is-${item.tone}` : ""
                        )}
                        onMouseEnter={() => setActiveIndex(absoluteIndex)}
                        onClick={() => onSelect(item)}
                      >
                        <div className="command-palette-item-copy">
                          <div className="command-palette-item-topline">
                            <span className="command-palette-item-eyebrow">{item.eyebrow || "Action"}</span>
                            {item.badge ? <span className="status-pill small neutral">{item.badge}</span> : null}
                          </div>
                          <strong>{item.title}</strong>
                          <p>{item.description}</p>
                        </div>

                        <div className="command-palette-item-meta">
                          {item.recent ? (
                            <span className="command-palette-item-chip">
                              <FiClock />
                              Recent
                            </span>
                          ) : null}
                          {item.meta ? <span className="command-palette-item-chip">{item.meta}</span> : null}
                          <span className="command-palette-item-icon">
                            <FiArrowUpRight />
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          ) : (
            <div className="command-palette-empty">
              <strong>No matching actions</strong>
              <p>Try a route name, a team area like inventory or reports, or a task like assistant or logout.</p>
            </div>
          )}
        </div>

        <div className="command-palette-footer">
          <span className="command-palette-footer-item">
            <FiCornerDownLeft />
            Open selection
          </span>
          <span className="command-palette-footer-item">Arrow keys to move</span>
          <span className="command-palette-footer-item">Esc to close</span>
        </div>
      </section>
    </div>
  );
}

export default GlobalCommandPalette;
