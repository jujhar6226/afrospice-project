import { useState } from "react";
import { useNavigate } from "react-router-dom";

import API from "../../api/api";
import { getDefaultRoute } from "../../config/access";
import { writeAuthSession } from "../../utils/sessionStore";
import "./Login.css";

function Login({ onLogin, settings }) {
  const [staffId, setStaffId] = useState("");
  const [pin, setPin] = useState("");
  const [rememberSession, setRememberSession] = useState(true);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const navigate = useNavigate();

  const branchCode = settings?.branchCode || "AFR-MAIN-001";
  const storeName = settings?.storeName || "AfroSpice Main Branch";

  const submitLogin = async () => {
    if (loading) {
      return;
    }

    setError("");
    setLoading(true);

    try {
      const res = await API.post("/auth/login", {
        staffId: staffId.trim(),
        pin: pin.trim(),
      });

      const user = res?.data?.data?.user;
      writeAuthSession(user || null);

      if (onLogin) {
        onLogin(user || null);
      }

      navigate(getDefaultRoute(user?.role), { replace: true, state: { rememberSession } });
    } catch (err) {
      console.error("Login failed:", err);
      setError(err?.message || err?.data?.message || "Login failed. Please check your Staff ID and PIN.");
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    await submitLogin();
  };

  return (
    <div className="login-page">
      <div className="login-stage">
        <section className="login-stage-copy" aria-label="AfroSpice workspace introduction">
          <div className="login-stage-brand">
            <div className="login-logo-lockup" aria-hidden="true">
              <span className="login-logo-shape login-logo-shape-top"></span>
              <span className="login-logo-shape login-logo-shape-bottom"></span>
            </div>
            <span className="login-stage-brand-name">AfroSpice</span>
          </div>

          <div className="login-stage-content">
            <p className="login-stage-eyebrow">Premium retail operations</p>
            <h1>
              Run your store with a <span>smarter, cleaner control</span> surface
            </h1>
            <p className="login-stage-description">
              Inventory, checkout, reporting, suppliers, customers, and operations - all in one refined business
              workspace.
            </p>
          </div>

          <div className="login-stage-wave" aria-hidden="true"></div>
        </section>

        <section className="login-auth-shell" aria-label="Workspace sign in">
          <div className="login-auth-card">
            <div className="login-auth-topbar">
              <div className="login-stage-brand login-stage-brand--compact">
                <div className="login-logo-lockup" aria-hidden="true">
                  <span className="login-logo-shape login-logo-shape-top"></span>
                  <span className="login-logo-shape login-logo-shape-bottom"></span>
                </div>
                <span className="login-stage-brand-name">AfroSpice</span>
              </div>

              <div className="login-auth-chip">{branchCode}</div>
            </div>

            <div className="login-auth-copy">
              <p className="login-auth-kicker">Welcome back</p>
              <h2>Sign in to your workspace</h2>
              <p>
                Access your command center, sales flow, stock operations, and reporting tools.
              </p>
            </div>

            <form className="login-form" onSubmit={handleLogin}>
              <div className="login-field">
                <label className="login-label" htmlFor="staffId">
                  Email or Staff ID
                </label>
                <input
                  id="staffId"
                  className="login-input"
                  type="text"
                  placeholder="Enter your email or staff ID"
                  value={staffId}
                  onChange={(event) => setStaffId(event.target.value)}
                  autoComplete="username"
                />
              </div>

              <div className="login-field">
                <label className="login-label" htmlFor="pin">
                  Password or PIN
                </label>
                <input
                  id="pin"
                  className="login-input"
                  type="password"
                  placeholder="Enter your password or PIN"
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  autoComplete="current-password"
                />
              </div>

              <label className="login-remember">
                <input
                  type="checkbox"
                  checked={rememberSession}
                  onChange={(event) => setRememberSession(event.target.checked)}
                />
                <span>Keep me signed in</span>
              </label>

              {error ? <p className="login-error">{error}</p> : null}

              <button type="submit" className="login-submit" disabled={loading}>
                {loading ? "Signing in..." : "Sign In"}
              </button>

              <button
                type="button"
                className="login-submit login-submit-secondary"
                onClick={submitLogin}
                disabled={loading}
              >
                Continue with Workspace Access
              </button>
            </form>

            <p className="login-auth-footnote">
              Connected to <strong>{storeName}</strong> using the live AfroSpice workspace runtime.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Login;
