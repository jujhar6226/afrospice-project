import axios from "axios";
import { clearAuthSession, hasAuthSession } from "../utils/sessionStore";

const CONFIGURED_BASE_URL = import.meta.env.VITE_API_URL || "";
const DEFAULT_BASE_URL = "/api";
const BASE_URL = CONFIGURED_BASE_URL || DEFAULT_BASE_URL;

const DEV_BASE_URL_CANDIDATES = [
  BASE_URL,
  "http://127.0.0.1:5000/api",
  "https://afrospice-backend.onrender.com/api",
].filter((value, index, collection) => Boolean(value) && collection.indexOf(value) === index);

let activeBaseUrl = BASE_URL;

function resolveFallbackBaseUrl(currentBaseUrl) {
  const normalizedCurrent = String(currentBaseUrl || "").trim();
  return (
    DEV_BASE_URL_CANDIDATES.find((candidate) => candidate !== normalizedCurrent) || null
  );
}

function hasAuthorizationHeader(headers) {
  if (!headers) return false;

  const directValue =
    headers.Authorization ||
    headers.authorization ||
    (typeof headers.get === "function" ? headers.get("Authorization") : "");

  return Boolean(String(directValue || "").trim());
}

function canRetryAgainstFallback(config) {
  const requestMethod = String(config?.method || "get").trim().toLowerCase();
  const isIdempotentRequest = ["get", "head", "options"].includes(requestMethod);
  const hasActiveSession = hasAuthSession();
  const carriesAuthorization = hasAuthorizationHeader(config?.headers);

  return isIdempotentRequest && !hasActiveSession && !carriesAuthorization;
}

const API = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

API.interceptors.request.use(
  (config) => {
    config.baseURL = activeBaseUrl;
    return config;
  },
  (error) => Promise.reject(error)
);

API.interceptors.response.use(
  (response) => {
    if (response?.config?.baseURL) {
      activeBaseUrl = response.config.baseURL;
    }
    return response;
  },
  (error) => {
    const originalConfig = error?.config || {};

    if (
      !error?.response &&
      import.meta.env.DEV &&
      !originalConfig.__afrospiceBaseRetried &&
      canRetryAgainstFallback(originalConfig)
    ) {
      const fallbackBaseUrl = resolveFallbackBaseUrl(originalConfig.baseURL || activeBaseUrl);
      if (fallbackBaseUrl) {
        activeBaseUrl = fallbackBaseUrl;
        originalConfig.__afrospiceBaseRetried = true;
        originalConfig.baseURL = fallbackBaseUrl;
        return API(originalConfig);
      }
    }

    if (!error?.response) {
      return Promise.reject({
        status: 503,
        message: `Cannot reach backend API. Tried: ${DEV_BASE_URL_CANDIDATES.join(", ")}. Start the workspace with "C:\\Users\\regan\\Downloads\\afrospice\\start-afrospice.cmd" or run "npm.cmd run dev" in C:\\Users\\regan\\Downloads\\afrospice\\backend.`,
        data: null,
        response: null,
        originalError: error,
      });
    }

    const status = error?.response?.status;
    const message =
      error?.response?.data?.message ||
      error?.message ||
      "Unexpected error occurred.";

    if (status === 401) {
      clearAuthSession();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("afrospice:logout"));
      }

      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }

    return Promise.reject({
      status: status || 500,
      message,
      data: error?.response?.data || null,
      response: error?.response || null,
      originalError: error,
    });
  }
);

export default API;
