import { useCallback, useEffect, useState } from "react";

import API from "../api/api";
import defaultSettings from "../config/defaultSettings";

const allowedSettingsKeys = new Set(Object.keys(defaultSettings));

function normalizeCurrency(value) {
  const code = String(value || defaultSettings.currency).trim().toUpperCase();
  return code === "USD" ? defaultSettings.currency : code || defaultSettings.currency;
}

function normalizeTimeZone(value) {
  const zone = String(value || defaultSettings.timeZone).trim();
  return zone === "UTC" ? defaultSettings.timeZone : zone || defaultSettings.timeZone;
}

function mergeSettings(payload) {
  const nextSettings = {
    ...defaultSettings,
    ...(payload || {}),
  };

  return {
    ...nextSettings,
    currency: normalizeCurrency(nextSettings.currency),
    timeZone: normalizeTimeZone(nextSettings.timeZone),
    taxRate: Number(nextSettings.taxRate ?? defaultSettings.taxRate),
  };
}

function useWorkspaceSettings(isAuthenticated) {
  const [settings, setSettings] = useState(defaultSettings);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState("");

  const loadSettings = useCallback(async () => {
    try {
      setSettingsLoading(true);
      setSettingsError("");

      const endpoint = isAuthenticated ? "/settings" : "/settings/public";
      const res = await API.get(endpoint);
      setSettings(mergeSettings(res?.data?.data));
    } catch (error) {
      console.error("Failed to load settings:", error);
      setSettings(defaultSettings);
      setSettingsError(error?.message || "Failed to load workspace settings.");
    } finally {
      setSettingsLoading(false);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const saveSettings = useCallback(async (patch) => {
    setSettingsSaving(true);
    setSettingsError("");

    try {
      const sanitizedPatch = Object.fromEntries(
        Object.entries(patch || {}).filter(([key]) => allowedSettingsKeys.has(key))
      );
      const res = await API.put("/settings", sanitizedPatch);
      const nextSettings = mergeSettings(res?.data?.data);
      setSettings(nextSettings);
      return nextSettings;
    } catch (error) {
      console.error("Failed to save settings:", error);
      setSettingsError(error?.message || "Failed to save workspace settings.");
      throw error;
    } finally {
      setSettingsSaving(false);
    }
  }, []);

  return {
    settings,
    settingsLoading,
    settingsSaving,
    settingsError,
    reloadSettings: loadSettings,
    saveSettings,
  };
}

export default useWorkspaceSettings;
