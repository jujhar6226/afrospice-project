const authService = require("../services/authService");
const asyncHandler = require("../utils/asyncHandler");
const { success } = require("../utils/response");
const { clearAuthCookie, setAuthCookie } = require("../utils/authCookie");

function setSensitiveResponseHeaders(res) {
  res.set("Cache-Control", "no-store, private");
  res.set("Pragma", "no-cache");
}

const login = asyncHandler(async (req, res) => {
  const payload = await authService.login(req.body || {});
  setSensitiveResponseHeaders(res);
  setAuthCookie(res, payload.token);

  return success(
    res,
    {
      user: payload.user,
      sessionMode: "cookie",
    },
    "Login successful."
  );
});

const changePin = asyncHandler(async (req, res) => {
  setSensitiveResponseHeaders(res);
  const payload = await authService.changePin(req.user, req.body || {});
  return success(res, payload, "PIN changed successfully.");
});

const logout = asyncHandler(async (req, res) => {
  setSensitiveResponseHeaders(res);
  const payload = await authService.logout(req.user);
  clearAuthCookie(res);
  return success(res, payload, "Logout successful.");
});

const me = asyncHandler(async (req, res) => {
  setSensitiveResponseHeaders(res);
  const payload = await authService.getAuthenticatedUser(req.user);
  return success(res, payload, "Authenticated user fetched.");
});

module.exports = {
  login,
  changePin,
  logout,
  me,
};
