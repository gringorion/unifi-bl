import { HttpError } from "./http-client.js";

export const CONFIG_EXPORT_SCHEMA_VERSION = 1;
export const CONFIG_EXPORT_KIND = "unifi_bl.configuration_export";
export const CONFIG_EXPORT_CLEAR_TEXT_WARNING =
  "This export contains runtime settings and API keys in clear text.";

export function buildConfigurationExport({
  appVersion = "",
  settings = {},
  blocklists = [],
} = {}) {
  return {
    schemaVersion: CONFIG_EXPORT_SCHEMA_VERSION,
    kind: CONFIG_EXPORT_KIND,
    appVersion: String(appVersion || "").trim(),
    exportedAt: new Date().toISOString(),
    warning: CONFIG_EXPORT_CLEAR_TEXT_WARNING,
    settings: structuredClone(settings || {}),
    blocklists: Array.isArray(blocklists) ? structuredClone(blocklists) : [],
  };
}

export function parseConfigurationImport(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "Invalid configuration export payload.");
  }

  const schemaVersion = Number(payload.schemaVersion || 0);
  if (schemaVersion !== CONFIG_EXPORT_SCHEMA_VERSION) {
    throw new HttpError(
      400,
      `Unsupported configuration export schema version: ${payload.schemaVersion ?? "missing"}.`,
    );
  }

  const kind = String(payload.kind || "").trim();
  if (kind !== CONFIG_EXPORT_KIND) {
    throw new HttpError(400, "Invalid configuration export file type.");
  }

  if (!payload.settings || typeof payload.settings !== "object" || Array.isArray(payload.settings)) {
    throw new HttpError(400, "The configuration export is missing its settings section.");
  }

  if (!Array.isArray(payload.blocklists)) {
    throw new HttpError(400, "The configuration export is missing its blocklists section.");
  }

  return {
    settings: structuredClone(payload.settings),
    blocklists: structuredClone(payload.blocklists),
  };
}
