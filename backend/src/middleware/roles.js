const AppError = require("../errors/AppError");

function allowRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(
        new AppError(401, "Unauthorized", {
          code: "AUTH_REQUIRED",
        })
      );
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AppError(403, "Forbidden: insufficient permissions", {
          code: "INSUFFICIENT_ROLE",
        })
      );
    }

    return next();
  };
}

module.exports = allowRoles;
