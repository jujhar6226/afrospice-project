import { Link } from "react-router-dom";

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

function CommandAction({ item, variant = "primary" }) {
  const label = variant === "secondary" ? item.secondaryLabel : item.actionLabel;
  const onClick = variant === "secondary" ? item.onSecondaryClick : item.onClick;
  const to = variant === "secondary" ? item.secondaryTo : item.to;
  const tone = variant === "secondary" ? "btn btn-secondary" : "btn btn-primary";

  if (!label) return null;

  if (to) {
    return (
      <Link className={joinClassNames(tone, "btn-compact")} to={to}>
        {label}
      </Link>
    );
  }

  return (
    <button type="button" className={joinClassNames(tone, "btn-compact")} onClick={onClick}>
      {label}
    </button>
  );
}

function CommandDeck({
  eyebrow = "Control Deck",
  title,
  description,
  items = [],
  className = "",
}) {
  if (!items.length) return null;

  return (
    <section className={joinClassNames("command-deck", className)}>
      <header className="command-deck-header">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h3>{title}</h3>
          {description ? <p className="panel-subtitle">{description}</p> : null}
        </div>
      </header>

      <div className="command-deck-grid">
        {items.map((item, index) => (
          <article
            key={item.key || item.title || index}
            className={joinClassNames(
              "command-card",
              item.tone ? `command-card--${item.tone}` : "",
              item.emphasis ? "command-card--emphasis" : "",
              `command-card--${(index % 4) + 1}`
            )}
          >
            <div className="command-card-head">
              <div className="command-card-copy">
                {item.eyebrow ? (
                  <div className="command-card-topline">
                    <span className="command-card-eyebrow">{item.eyebrow}</span>
                  </div>
                ) : null}
                <h4>{item.title}</h4>
                {item.description ? <p>{item.description}</p> : null}
              </div>

              {item.badge ? (
                <span className={joinClassNames("status-pill", "small", item.badgeTone || "neutral")}>
                  {item.badge}
                </span>
              ) : null}
            </div>

            {item.meta ? (
              <div className="command-card-meta">
                <span>{item.metaLabel || "Context"}</span>
                <strong>{item.meta}</strong>
              </div>
            ) : null}

            <div className="command-card-actions">
              <CommandAction item={item} />
              <CommandAction item={item} variant="secondary" />
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

export default CommandDeck;
