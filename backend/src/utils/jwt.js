const jwt = require("jsonwebtoken");
const runtime = require("../config/runtime");

const JWT_SECRET = runtime.jwtSecret;
const JWT_EXPIRES = runtime.jwtExpires;

function signToken(payload) {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES,
    issuer: runtime.jwtIssuer,
    audience: runtime.jwtAudience,
    algorithm: "HS256",
  });
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET, {
    algorithms: ["HS256"],
    issuer: runtime.jwtIssuer,
    audience: runtime.jwtAudience,
  });
}

function decodeToken(token) {
  return jwt.decode(token);
}

module.exports = {
  signToken,
  verifyToken,
  decodeToken,
};
