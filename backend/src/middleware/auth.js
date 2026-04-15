const { verifyToken } = require("../utils/jwt");
const { clearAuthCookie, getRequestAuthToken } = require("../utils/authCookie");
const runtime = require("../config/runtime");
const AppError = require("../errors/AppError");
const authRepository = require("../data/repositories/authRepository");

function isLoopbackIp(address) {
  const normalized = String(address || "").trim().toLowerCase();
  return (
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.startsWith("::ffff:127.0.0.1")
  );
}

function isLocalRequest(req) {
  const ipCandidates = [
    req.ip,
    ...(Array.isArray(req.ips) ? req.ips : []),
    req.socket?.remoteAddress,
  ];

  return ipCandidates.some((address) => isLoopbackIp(address));
}

function readSessionDate(value) {
  if (!value) return null;

  const normalized = value instanceof Date ? value : new Date(value);
  return Number.isNaN(normalized.getTime()) ? null : normalized;
}

function resolveSessionExpiry(session) {
  const loginAt = readSessionDate(session?.loginAt);
  const lastSeenAt = readSessionDate(session?.lastSeenAt) || loginAt;

  if (!loginAt || !lastSeenAt) {
    return {
      expired: true,
      reason: "Session metadata is invalid. Please sign in again.",
      logoutReason: "Session metadata was invalid.",
      code: "SESSION_INVALID_METADATA",
    };
  }

  const now = Date.now();
  const idleTimeoutMs = runtime.sessionIdleTimeoutMinutes * 60 * 1000;
  const absoluteTimeoutMs = runtime.sessionAbsoluteTimeoutMinutes * 60 * 1000;

  if (now - lastSeenAt.getTime() > idleTimeoutMs) {
    return {
      expired: true,
      reason: "Session expired due to inactivity. Please sign in again.",
      logoutReason: "Session expired due to inactivity.",
      code: "SESSION_IDLE_EXPIRED",
    };
  }

  if (now - loginAt.getTime() > absoluteTimeoutMs) {
    return {
      expired: true,
      reason: "Session expired. Please sign in again.",
      logoutReason: "Session reached its maximum lifetime.",
      code: "SESSION_MAX_AGE_EXPIRED",
    };
  }

  return {
    expired: false,
  };
}

async function authMiddleware(req, res, next) {
  if (runtime.authBypassEnabled) {
    if (!isLocalRequest(req)) {
      return next(
        new AppError(403, "Auth bypass is restricted to local requests.", {
          code: "AUTH_BYPASS_LOCAL_ONLY",
        })
      );
    }

    const activeUsers = await authRepository.getActiveUsers();
    const devUser =
      activeUsers.find(
        (item) => ["Owner", "Manager"].includes(String(item.role))
      ) || activeUsers[0] || null;

    req.user = devUser
      ? {
          id: devUser.id,
          staffId: devUser.staffId,
          fullName: devUser.fullName,
          role: devUser.role,
          email: devUser.email,
          status: devUser.status,
          forcePinChange: Boolean(devUser.forcePinChange),
        }
      : {
          id: 0,
          staffId: "DEV-AUTH",
          fullName: "Development User",
          role: "Owner",
          email: "dev@afrospice.local",
          status: "Active",
          forcePinChange: false,
        };

    return next();
  }

  const token = getRequestAuthToken(req);

  if (!token) {
    return next(
      new AppError(401, "Unauthorized", {
        code: "MISSING_AUTH_TOKEN",
      })
    );
  }

  try {
    const decoded = verifyToken(token);
    const sessionId = String(decoded.sessionId || "").trim();
    const user = await authRepository.getUserById(decoded.id);

    if (!user) {
      clearAuthCookie(res);
      return next(
        new AppError(401, "User no longer exists.", {
          code: "USER_NOT_FOUND",
        })
      );
    }

    if (!sessionId) {
      clearAuthCookie(res);
      return next(
        new AppError(401, "Session is invalid. Please sign in again.", {
          code: "INVALID_SESSION",
        })
      );
    }

    const session = await authRepository.getUserSessionById(sessionId);

    if (!session || String(session.status || "").trim() !== "Active" || Number(session.userId) !== Number(user.id)) {
      clearAuthCookie(res);
      return next(
        new AppError(401, "Session is no longer active. Please sign in again.", {
          code: "SESSION_NOT_ACTIVE",
        })
      );
    }

    const expiry = resolveSessionExpiry(session);
    if (expiry.expired) {
      await authRepository.closeUserSession(sessionId, {
        logoutReason: expiry.logoutReason,
      });
      clearAuthCookie(res);

      return next(
        new AppError(401, expiry.reason, {
          code: expiry.code,
        })
      );
    }

    if (String(user.status) === "Pending Approval") {
      return next(
        new AppError(403, "User account is waiting for owner approval.", {
          code: "ACCOUNT_PENDING_APPROVAL",
        })
      );
    }

    if (String(user.status) !== "Active") {
      return next(
        new AppError(403, "User account is inactive.", {
          code: "ACCOUNT_INACTIVE",
        })
      );
    }

    if (String(user.pinStatus) !== "Assigned" || !String(user.pin || "").trim()) {
      return next(
        new AppError(403, "User account does not have an active PIN.", {
          code: "PIN_NOT_ASSIGNED",
        })
      );
    }

    req.user = {
      id: user.id,
      staffId: user.staffId,
      fullName: user.fullName,
      role: user.role,
      email: user.email,
      status: user.status,
      pinStatus: user.pinStatus,
      forcePinChange: Boolean(user.forcePinChange),
      sessionId,
    };

    await authRepository.touchUserSession(sessionId);

    return next();
  } catch (error) {
    clearAuthCookie(res);
    return next(
      error instanceof AppError
        ? error
        : new AppError(401, "Invalid or expired token", {
            code: "INVALID_AUTH_TOKEN",
          })
    );
  }
}

module.exports = authMiddleware;
