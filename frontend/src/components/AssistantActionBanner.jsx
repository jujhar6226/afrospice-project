function AssistantActionBanner({ label = "", note = "" }) {
  if (!label) return null;

  return (
    <div className="assistant-action-banner" role="status" aria-live="polite">
      <span className="assistant-action-banner-tag">Owner AI Highlight</span>
      <div className="assistant-action-banner-copy">
        <strong>{label}</strong>
        <p>
          {note ||
            "This panel is the strongest destination for the question you asked in Owner AI."}
        </p>
      </div>
    </div>
  );
}

export default AssistantActionBanner;
