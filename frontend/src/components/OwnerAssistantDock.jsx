import { useEffect, useMemo, useRef, useState } from "react";
import {
  FaArrowTrendUp as FiTrendingUp,
  FaArrowUpRightFromSquare as FiArrowUpRight,
  FaBoltLightning as FiZap,
  FaBoxArchive as FiPackage,
  FaPaperPlane as FiSend,
  FaUsers as FiUsers,
  FaXmark as FiX,
  FaComments as FiMessageSquare,
} from "react-icons/fa6";
import { useNavigate } from "react-router-dom";

import API from "../api/api";

function createMessage(role, payload) {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    ...payload,
  };
}

function normalizeAction(action = {}) {
  return {
    label: String(action?.label || "").trim(),
    path: String(action?.path || "").trim(),
    focus: String(action?.focus || "").trim(),
    note: String(action?.note || "").trim(),
  };
}

function createAssistantPayload(data = {}, fallbackContent = "") {
  return {
    headline: data?.headline || "Owner AI Assistant",
    content: data?.greeting || data?.answer || fallbackContent,
    highlights: Array.isArray(data?.highlights) ? data.highlights : [],
    comparisons: Array.isArray(data?.comparisons) ? data.comparisons : [],
    actions: Array.isArray(data?.actions) ? data.actions.map(normalizeAction).filter((item) => item.label && item.path) : [],
    drilldowns: Array.isArray(data?.drilldowns)
      ? data.drilldowns
          .map((item) => ({
            title: String(item?.title || "").trim(),
            summary: String(item?.summary || "").trim(),
            steps: Array.isArray(item?.steps)
              ? item.steps.map(normalizeAction).filter((step) => step.label && step.path)
              : [],
          }))
          .filter((item) => item.title && item.steps.length)
      : [],
    questionBack: data?.questionBack || "",
    sources: Array.isArray(data?.sources) ? data.sources : [],
    followUps: Array.isArray(data?.followUps) ? data.followUps : [],
    statusTone: data?.statusTone || "success",
    statusLabel: data?.statusLabel || "",
    disclosure: data?.disclosure || "",
    engine: data?.engine || null,
  };
}

function OwnerAssistantDock({ sessionUser }) {
  const navigate = useNavigate();
  const threadRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const displayName = useMemo(
    () => sessionUser?.fullName?.split(" ")?.[0] || "there",
    [sessionUser?.fullName]
  );
  const latestAssistantEngine = useMemo(() => {
    const assistantMessage = [...messages].reverse().find((message) => message.role === "assistant" && message.engine);
    return assistantMessage?.engine || "";
  }, [messages]);
  const quickPrompts = useMemo(
    () => [
      {
        label: "Revenue pulse",
        note: "What changed in revenue this week?",
        prompt: "What changed in revenue this week?",
        icon: FiTrendingUp,
      },
      {
        label: "Stock risk",
        note: "Which products are at stockout risk?",
        prompt: "Which products are at stockout risk?",
        icon: FiPackage,
      },
      {
        label: "Workforce view",
        note: "What is the biggest staffing issue right now?",
        prompt: "What is the biggest staffing issue right now?",
        icon: FiUsers,
      },
      {
        label: "Next move",
        note: "Which supplier needs attention now?",
        prompt: "Which supplier needs attention now?",
        icon: FiZap,
      },
    ],
    []
  );

  useEffect(() => {
    const handleOpen = () => setOpen(true);
    window.addEventListener("afrospice:owner-ai:open", handleOpen);
    return () => window.removeEventListener("afrospice:owner-ai:open", handleOpen);
  }, []);

  useEffect(() => {
    if (!open || bootstrapped || loading) return;

    let cancelled = false;

    const loadBootstrap = async () => {
      try {
        setLoading(true);
        setError("");
        const response = await API.get("/reports/owner-assistant");
        const data = response?.data?.data || {};
        if (cancelled) return;

        setMessages([
          createMessage(
            "assistant",
            createAssistantPayload(
              {
                ...data,
                headline: data?.headline || `Hello ${displayName}`,
              },
              "Ask anything about sales, stock, staff, supplier risk, or forecasting."
            )
          ),
        ]);
      } catch (requestError) {
        if (cancelled) return;

        const routeMissing = Number(requestError?.status || requestError?.response?.status || 0) === 404;
        setError(
          routeMissing
            ? "Assistant route is not live on the running backend yet."
            : requestError?.message || "Could not start the assistant."
        );
        setMessages([
          createMessage(
            "assistant",
            createAssistantPayload(
              {
                headline: `Hello ${displayName}`,
                answer: routeMissing
                  ? "The assistant route is not available on the running backend yet. Restart the backend and try again."
                  : "I can help with revenue, inventory, staff, supplier pressure, and forecast questions once the live data route responds again.",
                followUps: [
                  "What does the demand forecast say for next week?",
                  "Which products are at stockout risk?",
                ],
                statusTone: "warning",
                statusLabel: "Needs Attention",
              },
              ""
            )
          ),
        ]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setBootstrapped(true);
        }
      }
    };

    loadBootstrap();

    return () => {
      cancelled = true;
    };
  }, [bootstrapped, displayName, loading, open]);

  useEffect(() => {
    if (!threadRef.current) return;
    threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [messages, loading]);

  const sendQuestion = async (rawQuestion) => {
    const question = String(rawQuestion || input).trim();
    if (!question || loading) return;

    const userMessage = createMessage("user", {
      headline: "You",
      content: question,
    });

    const nextHistory = [...messages, userMessage].map((message) => ({
      role: message.role,
      content: [message.headline, message.content, message.questionBack ? `Assistant asks: ${message.questionBack}` : ""]
        .filter(Boolean)
        .join(" "),
    }));

    setMessages((current) => [...current, userMessage]);
    setInput("");
    setError("");
    setLoading(true);

    try {
      const response = await API.post("/reports/owner-assistant", {
        question,
        history: nextHistory.slice(-8),
      });
      const data = response?.data?.data || null;

      setMessages((current) => [
        ...current,
        createMessage("assistant", createAssistantPayload(data, "No answer was returned.")),
      ]);
    } catch (requestError) {
      const routeMissing = Number(requestError?.status || requestError?.response?.status || 0) === 404;
      setError(
        routeMissing
          ? "Assistant route is not live on the running backend yet."
          : requestError?.message || "Assistant reply failed."
      );
      setMessages((current) => [
        ...current,
        createMessage(
          "assistant",
          createAssistantPayload(
            {
              headline: "Assistant unavailable",
              answer: routeMissing
                ? "The assistant route is not live on the running backend yet. Restart the backend and ask again."
                : "I could not answer that from the live workspace right now.",
              statusTone: "warning",
              statusLabel: "Needs Attention",
            },
            ""
          )
        ),
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (event) => {
    event.preventDefault();
    sendQuestion(input);
  };

  const handleAction = (action) => {
    const path = String(action?.path || "").trim();
    if (!path) return;

    navigate(path, {
      state: {
        assistantFocus: action?.focus || "",
        assistantActionLabel: action?.label || "",
        assistantActionNote: action?.note || "",
        assistantTs: Date.now(),
      },
    });
    setOpen(false);
  };

  return (
    <div className="chatbot owner-assistant-widget">
      {open ? (
        <section className="chatbot-window owner-assistant-card" aria-label="Owner AI assistant">
          <header className="owner-assistant-header">
            <div className="owner-assistant-header-copy">
              <span className="owner-assistant-eyebrow">Grounded workspace AI</span>
              <h3>Executive Assistant</h3>
              <p>Live answers and next actions pulled from your sales, stock, suppliers, and staffing data.</p>
              {latestAssistantEngine ? (
                <div className="owner-assistant-status-row">
                  <span className="status-pill small">{latestAssistantEngine}</span>
                  <span className="owner-assistant-status-note">Live workspace context</span>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="owner-assistant-close"
              aria-label="Close assistant"
              onClick={() => setOpen(false)}
            >
              <FiX />
            </button>
          </header>

          <div className="owner-assistant-shortcuts">
            {quickPrompts.map((prompt) => (
              <button
                key={prompt.prompt}
                type="button"
                className="owner-assistant-shortcut"
                onClick={() => sendQuestion(prompt.prompt)}
                disabled={loading}
              >
                <span className="owner-assistant-shortcut-icon">
                  <prompt.icon />
                </span>
                <span className="owner-assistant-shortcut-copy">
                  <strong>{prompt.label}</strong>
                  <small>{prompt.note}</small>
                </span>
              </button>
            ))}
          </div>

          <div className="owner-assistant-thread" ref={threadRef}>
            {!messages.length && !loading ? (
              <div className="owner-assistant-empty">
                <span className="owner-assistant-message-label">Business assistant</span>
                <strong>Ask a live operating question.</strong>
                <p>Use the prompt cards above or ask directly about revenue, inventory, supplier risk, staffing, or forecasting.</p>
              </div>
            ) : null}

            {messages.map((message) => (
              <article
                key={message.id}
                className={`owner-assistant-message owner-assistant-message-${message.role}`}
              >
                <div className="owner-assistant-message-top">
                  <div className="owner-assistant-message-meta">
                    <span className="owner-assistant-message-dot" />
                    <span className="owner-assistant-message-label">
                      {message.headline || (message.role === "user" ? "You" : "Assistant")}
                    </span>
                  </div>
                  {message.role === "assistant" && message.statusLabel ? (
                    <span
                      className={`status-pill ${
                        message.statusTone === "danger"
                          ? "danger"
                          : message.statusTone === "warning"
                          ? "warning"
                          : "success"
                      }`}
                    >
                      {message.statusLabel}
                    </span>
                  ) : null}
                </div>

                <div className="owner-assistant-message-body">
                  <p>{message.content}</p>
                </div>

                {message.highlights?.length ? (
                  <div className="owner-assistant-highlights">
                      {message.highlights.map((item) => (
                      <article
                        key={`${message.id}-${item.label}-${item.value}`}
                        className="owner-assistant-highlight"
                      >
                        <span>{item.label}</span>
                        <strong>{item.value}</strong>
                      </article>
                    ))}
                  </div>
                ) : null}

                {message.comparisons?.length ? (
                  <div className="owner-assistant-comparisons">
                    {message.comparisons.map((comparison, index) => (
                      <article
                        key={`${message.id}-${comparison.title || index}`}
                        className="owner-assistant-comparison-card"
                      >
                        <div className="owner-assistant-comparison-head">
                          <strong>{comparison.title || "Comparison"}</strong>
                          {comparison.caption ? <small>{comparison.caption}</small> : null}
                        </div>
                        <div className="owner-assistant-comparison-table-wrap">
                          <table className="owner-assistant-comparison-table">
                            <thead>
                              <tr>
                                {(comparison.columns || []).map((column) => (
                                  <th key={`${message.id}-${comparison.title}-${column}`}>{column}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {(comparison.rows || []).map((row, rowIndex) => (
                                <tr key={`${message.id}-${comparison.title}-${rowIndex}`}>
                                  {row.map((cell, cellIndex) => (
                                    <td key={`${message.id}-${comparison.title}-${rowIndex}-${cellIndex}`}>{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}

                {message.actions?.length ? (
                  <div className="owner-assistant-actions">
                    {message.actions.map((action) => (
                      <button
                        key={`${message.id}-${action.path}-${action.label}`}
                        type="button"
                        className="owner-assistant-action"
                        onClick={() => handleAction(action)}
                      >
                        <div className="owner-assistant-action-copy">
                          <strong>{action.label}</strong>
                          <span>{action.note || action.path}</span>
                        </div>
                        <span className="owner-assistant-action-arrow">
                          <FiArrowUpRight />
                        </span>
                      </button>
                    ))}
                  </div>
                ) : null}

                {message.drilldowns?.length ? (
                  <div className="owner-assistant-drilldowns">
                    {message.drilldowns.map((drilldown, index) => (
                      <article
                        key={`${message.id}-${drilldown.title || index}`}
                        className="owner-assistant-drilldown-card"
                      >
                        <div className="owner-assistant-drilldown-head">
                          <strong>{drilldown.title}</strong>
                          {drilldown.summary ? <small>{drilldown.summary}</small> : null}
                        </div>
                        <div className="owner-assistant-actions">
                          {drilldown.steps.map((action) => (
                          <button
                              key={`${message.id}-${drilldown.title}-${action.path}-${action.focus}`}
                              type="button"
                              className="owner-assistant-action"
                              onClick={() => handleAction(action)}
                            >
                              <div className="owner-assistant-action-copy">
                                <strong>{action.label}</strong>
                                <span>{action.note || action.path}</span>
                              </div>
                              <span className="owner-assistant-action-arrow">
                                <FiArrowUpRight />
                              </span>
                            </button>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                ) : null}

                {message.followUps?.length ? (
                  <div className="owner-assistant-followups">
                    {message.followUps.map((followUp) => (
                      <button
                        key={`${message.id}-${followUp}`}
                        type="button"
                        className="owner-assistant-chip"
                        onClick={() => sendQuestion(followUp)}
                      >
                        {followUp}
                      </button>
                    ))}
                  </div>
                ) : null}

                {message.sources?.length ? (
                  <div className="owner-assistant-sources">
                    {message.sources.map((source) => (
                      <span key={`${message.id}-${source}`} className="owner-assistant-source-pill">
                        {source}
                      </span>
                    ))}
                  </div>
                ) : null}

                {message.questionBack ? (
                  <div className="owner-assistant-questionback">
                    <span>Assistant asks</span>
                    <p>{message.questionBack}</p>
                  </div>
                ) : null}

                {message.disclosure ? <div className="owner-assistant-disclosure">{message.disclosure}</div> : null}
              </article>
            ))}

            {loading ? (
              <article className="owner-assistant-message owner-assistant-message-assistant">
                <div className="owner-assistant-message-top">
                  <div className="owner-assistant-message-meta">
                    <span className="owner-assistant-message-dot" />
                    <span className="owner-assistant-message-label">Assistant</span>
                  </div>
                  <span className="status-pill warning">Thinking</span>
                </div>
                <p>Reading the live workspace data and preparing an answer.</p>
              </article>
            ) : null}
          </div>

          <div className="owner-assistant-footer">
            {error ? <div className="info-banner inventory-error-banner">{error}</div> : null}

            <form className="owner-assistant-composer" onSubmit={handleSubmit}>
              <textarea
                className="input owner-assistant-input"
                rows="3"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    handleSubmit(event);
                  }
                }}
                placeholder="Ask about revenue, inventory, orders, suppliers, staffing, or forecasting."
              />
              <div className="owner-assistant-composer-row">
                <small className="owner-assistant-helper">
                  Grounded in live business data. Use exact IDs, time windows, product names, or supplier names for sharper answers.
                </small>
                <button type="submit" className="btn btn-primary owner-assistant-send" disabled={loading || !input.trim()}>
                  <FiSend />
                  {loading ? "Thinking..." : "Send"}
                </button>
              </div>
            </form>
          </div>
        </section>
      ) : (
        <button
          type="button"
          className="chatbot-button owner-assistant-trigger"
          aria-label="Open business assistant"
          onClick={() => setOpen(true)}
        >
          <span className="owner-assistant-trigger-icon">
            <FiMessageSquare />
          </span>
          <span className="owner-assistant-trigger-copy">
            <strong>Ask AfroSpice AI</strong>
            <small>Live workspace assistant</small>
          </span>
        </button>
      )}
    </div>
  );
}

export default OwnerAssistantDock;
