require("./config/loadEnv");

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const runtime = require("./config/runtime");
const { connectDB } = require("./config/db");
const storeRuntime = require("./data/storeRuntime");

const authRoutes = require("./routes/authRoutes");
const productRoutes = require("./routes/productRoutes");
const salesRoutes = require("./routes/salesRoutes");
const reportRoutes = require("./routes/reportRoutes");
const userRoutes = require("./routes/userRoutes");
const customerRoutes = require("./routes/customerRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const purchaseOrderRoutes = require("./routes/purchaseOrderRoutes");
const cycleCountRoutes = require("./routes/cycleCountRoutes");
const settingsRoutes = require("./routes/settingsRoutes");
const systemRoutes = require("./routes/systemRoutes");
const { notFoundHandler, errorHandler } = require("./middleware/errorMiddleware");

const app = express();
const allowedOriginSet = new Set(runtime.allowedOrigins);
const localDevOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;
const publicHealthPathPattern = /^\/api\/system\/(health|readiness)(?:\/.*)?$/i;

function isSecureRequest(req) {
  if (req.secure) {
    return true;
  }

  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").trim().toLowerCase();
  return forwardedProto === "https";
}

function resolveCorsOrigin(origin, callback) {
  // Non-browser calls (curl/server-to-server) may not send Origin.
  if (!origin) {
    return callback(null, true);
  }

  if (allowedOriginSet.has(origin)) {
    return callback(null, true);
  }

  if (runtime.isDevelopment && localDevOriginPattern.test(origin)) {
    return callback(null, true);
  }

  return callback(new Error(`Origin not allowed by CORS: ${origin}`));
}

app.disable("x-powered-by");
app.set("trust proxy", runtime.trustProxy);

app.use(
  helmet({
    crossOriginResourcePolicy: false,
    hsts: runtime.isProduction
      ? {
          maxAge: 15552000,
          includeSubDomains: true,
        }
      : false,
  })
);

app.use((req, res, next) => {
  if (!runtime.enforceHttps) {
    return next();
  }

  if (publicHealthPathPattern.test(req.path)) {
    return next();
  }

  if (isSecureRequest(req)) {
    return next();
  }

  return res.status(426).json({
    success: false,
    message: "HTTPS is required for this environment.",
    code: "HTTPS_REQUIRED",
  });
});

app.use(
  cors({
    origin: resolveCorsOrigin,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type"],
    maxAge: 60 * 60,
    optionsSuccessStatus: 204,
  })
);

if (runtime.rateLimitEnabled) {
  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: Number(process.env.RATE_LIMIT_MAX || 300),
      standardHeaders: true,
      legacyHeaders: false,
    })
  );
}

app.use(express.json({ limit: "1mb" }));
app.use(
  express.urlencoded({
    extended: false,
    limit: "100kb",
    parameterLimit: 100,
  })
);
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

app.get("/", (req, res) => {
  return res.status(200).json({
    success: true,
    message: "AfroSpice backend is running.",
  });
});

app.use("/api/system", systemRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/products", productRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/reports", reportRoutes);
app.use("/api/users", userRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/purchase-orders", purchaseOrderRoutes);
app.use("/api/cycle-counts", cycleCountRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

app.initialize = async () => {
  await connectDB();
  await storeRuntime.initialize();

  return app;
};

module.exports = app;
