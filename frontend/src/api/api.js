import axios from "axios";
import { clearAuthSession } from "../utils/sessionStore";

const CONFIGURED_BASE_URL = String(import.meta.env.VITE_API_URL || "").trim();
const DEFAULT_BASE_URL = "/api";
const BASE_URL = CONFIGURED_BASE_URL || DEFAULT_BASE_URL;

const API = axios.create({
  baseURL: BASE_URL,
  timeout: 20000,
  withCredentials: true,
  headers: {
    "Content-Type": "application/json",
  },
});

API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (!error?.response) {
      return Promise.reject({
        status: 503,
        message: `Cannot reach backend API at ${BASE_URL}.`,
        data: null,
        response: null,
        originalError: error,
      });
    }

    const status = error.response.status;
    const message =
      error.response?.data?.message ||
      error.message ||
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
      data: error.response?.data || null,
      response: error.response || null,
      originalError: error,
    });
  }
);

export default API;