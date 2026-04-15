const DEFAULT_RANGE_OPTIONS = [
  { value: "daily", label: "Daily", short: "D" },
  { value: "weekly", label: "Weekly", short: "W" },
  { value: "monthly", label: "Monthly", short: "M" },
  { value: "yearly", label: "Yearly", short: "Y" },
];

function joinClassNames(...values) {
  return values.filter(Boolean).join(" ");
}

function TimeRangeSwitch({
  value,
  onChange,
  options = DEFAULT_RANGE_OPTIONS,
  ariaLabel = "Time range",
  className = "",
}) {
  return (
    <div className={joinClassNames("range-switch", className)} role="tablist" aria-label={ariaLabel}>
      {options.map((option) => {
        const active = value === option.value;

        return (
          <button
            key={option.value}
            type="button"
            className={active ? "range-switch-pill is-active" : "range-switch-pill"}
            onClick={() => onChange(option.value)}
            aria-pressed={active}
          >
            <strong>{option.label}</strong>
          </button>
        );
      })}
    </div>
  );
}

export { DEFAULT_RANGE_OPTIONS };
export default TimeRangeSwitch;
