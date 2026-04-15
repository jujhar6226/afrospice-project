const bcrypt = require("bcryptjs");
const AppError = require("../errors/AppError");
const authRepository = require("../data/repositories/authRepository");
const { signToken } = require("../utils/jwt");
const {
  validateLoginPayload,
  validateChangePinPayload,
} = require("../validation/authValidators");

const MAX_LOGIN_FAILURES = 5;
const LOGIN_FAILURE_WINDOW_MINUTES = 15;

function sanitizeUser(user) {
  if (!user) return null;
  const { pin, ...safeUser } = user;
  return safeUser;
}

function getAccessBlockMessage(user) {
  if (String(user.status) === "Pending Approval") {
    return "This staff record is waiting for owner approval.";
  }

  if (String(user.status) !== "Active") {
    return "This user account is inactive.";
  }

  if (String(user.pinStatus) !== "Assigned" || !String(user.pin || "").trim()) {
    return "PIN has not been issued for this account yet.";
  }

  return "";
}

async function assertLoginNotLocked(staffId) {
  const failures = await authRepository.countRecentLoginFailuresForStaffId(
    staffId,
    LOGIN_FAILURE_WINDOW_MINUTES
  );

  if (failures >= MAX_LOGIN_FAILURES) {
    throw new AppError(
      429,
      "Too many failed login attempts. Please wait before trying again.",
      {
        code: "LOGIN_TEMPORARILY_LOCKED",
      }
    );
  }
}

async function login(payload) {
  const { staffId, pin } = validateLoginPayload(payload);
  await assertLoginNotLocked(staffId);

  const user = await authRepository.getUserByStaffId(staffId);

  if (!user) {
    await authRepository.recordUserLoginFailure(staffId, "Invalid Staff ID or PIN.");
    throw new AppError(401, "Invalid Staff ID or PIN.", {
      code: "INVALID_CREDENTIALS",
    });
  }

  const accessBlockMessage = getAccessBlockMessage(user);

  if (accessBlockMessage) {
    await authRepository.recordUserLoginFailure(staffId, accessBlockMessage);
    throw new AppError(403, accessBlockMessage, {
      code: "ACCOUNT_NOT_READY",
    });
  }

  const isValidPin = await bcrypt.compare(String(pin), String(user.pin));

  if (!isValidPin) {
    await authRepository.recordUserLoginFailure(staffId, "Invalid Staff ID or PIN.");
    throw new AppError(401, "Invalid Staff ID or PIN.", {
      code: "INVALID_CREDENTIALS",
    });
  }

  const session = await authRepository.createUserSession(user, {
    loginReason: "Workspace sign-in",
  });

  const token = signToken({
    id: user.id,
    staffId: user.staffId,
    role: user.role,
    fullName: user.fullName,
    sessionId: session?.id || "",
  });

  return {
    token,
    user: sanitizeUser(user),
  };
}

async function changePin(userContext, payload) {
  const existing = await authRepository.getUserById(userContext?.id);

  if (!existing) {
    throw new AppError(404, "User not found.", {
      code: "USER_NOT_FOUND",
    });
  }

  const { currentPin, nextPin } = validateChangePinPayload(payload);
  const currentMatches = await bcrypt.compare(String(currentPin), String(existing.pin || ""));

  if (!currentMatches) {
    await authRepository.recordUserLoginFailure(
      existing.staffId,
      "PIN change failed: current PIN did not match."
    );
    throw new AppError(401, "Current PIN is incorrect.", {
      code: "INVALID_CURRENT_PIN",
    });
  }

  const nextHash = await bcrypt.hash(String(nextPin), 10);
  const updatedUser = await authRepository.changeOwnUserPin(existing.id, nextHash);

  return {
    user: sanitizeUser(updatedUser),
  };
}

async function logout(userContext) {
  if (userContext?.sessionId) {
    await authRepository.closeUserSession(userContext.sessionId, {
      logoutReason: "Manual workspace logout",
    });
  }

  return {};
}

async function getAuthenticatedUser(userContext) {
  const existing = userContext?.id ? await authRepository.getUserById(userContext.id) : null;

  return {
    user: existing ? sanitizeUser(existing) : userContext || null,
  };
}

module.exports = {
  login,
  changePin,
  logout,
  getAuthenticatedUser,
};
