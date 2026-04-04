import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

import {
  DEFAULT_UNIFI_IPSET_MAX_ENTRIES,
  toUnifiIpSetMaxEntries,
} from "./unifi-ipset.js";

function loadDotEnvFile() {
  const envPath = path.join(process.cwd(), ".env");
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function toNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function trimTrailingSlash(value) {
  return String(value ?? "").replace(/\/+$/, "");
}

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid JSON in configuration: ${error.message}`);
  }
}

export function loadConfig() {
  loadDotEnvFile();
  const cwd = process.cwd();
  const authUsername = String(process.env.APP_AUTH_USERNAME || "").trim();
  const authPassword = String(process.env.APP_AUTH_PASSWORD || "");
  const authPasswordSeed = String(process.env.APP_AUTH_PASSWORD_SEED || "");
  const authConfiguredValues = [
    authUsername,
    authPassword,
    authPasswordSeed,
  ].filter(Boolean);

  if (authConfiguredValues.length > 0 && authConfiguredValues.length < 3) {
    throw new Error(
      "APP_AUTH_USERNAME, APP_AUTH_PASSWORD, and APP_AUTH_PASSWORD_SEED must all be set together or all be empty.",
    );
  }

  const config = {
    appTitle: process.env.APP_TITLE || "UniFi Blocklists",
    port: toNumber(process.env.PORT, 8080),
    requestTimeoutMs: toNumber(process.env.REQUEST_TIMEOUT_MS, 15000),
    allowInsecureTls: toBoolean(process.env.ALLOW_INSECURE_TLS, false),
    dataFile:
      process.env.DATA_FILE || path.join(cwd, "data", "blocklists.json"),
    settingsFile:
      process.env.SETTINGS_FILE || path.join(cwd, "data", "settings.json"),
    auth: {
      enabled: Boolean(authUsername && authPassword && authPasswordSeed),
      username: authUsername,
      password: authPassword,
      passwordSeed: authPasswordSeed,
    },
    unifi: {
      networkBaseUrl: trimTrailingSlash(process.env.UNIFI_NETWORK_BASE_URL),
      networkApiKey: process.env.UNIFI_NETWORK_API_KEY || "",
      siteId: process.env.UNIFI_SITE_ID || "",
      siteManagerBaseUrl: trimTrailingSlash(
        process.env.UNIFI_SITE_MANAGER_BASE_URL || "https://api.ui.com/v1",
      ),
      siteManagerApiKey: process.env.UNIFI_SITE_MANAGER_API_KEY || "",
      blocklists: {
        listPath:
          process.env.UNIFI_BLOCKLISTS_LIST_PATH ||
          "{networkRootUrl}/api/s/{siteRef}/rest/firewallgroup",
        createPath:
          process.env.UNIFI_BLOCKLISTS_CREATE_PATH ||
          "{networkRootUrl}/api/s/{siteRef}/rest/firewallgroup",
        updatePath:
          process.env.UNIFI_BLOCKLISTS_UPDATE_PATH ||
          "{networkRootUrl}/api/s/{siteRef}/rest/firewallgroup/{id}",
        deletePath:
          process.env.UNIFI_BLOCKLISTS_DELETE_PATH ||
          "{networkRootUrl}/api/s/{siteRef}/rest/firewallgroup/{id}",
        createMethod:
          process.env.UNIFI_BLOCKLISTS_CREATE_METHOD || "POST",
        updateMethod:
          process.env.UNIFI_BLOCKLISTS_UPDATE_METHOD || "PUT",
        deleteMethod:
          process.env.UNIFI_BLOCKLISTS_DELETE_METHOD || "DELETE",
        idField: process.env.UNIFI_BLOCKLISTS_ID_FIELD || "_id",
        nameField: process.env.UNIFI_BLOCKLISTS_NAME_FIELD || "name",
        descriptionField:
          process.env.UNIFI_BLOCKLISTS_DESCRIPTION_FIELD || "",
        cidrsField:
          process.env.UNIFI_BLOCKLISTS_CIDRS_FIELD || "group_members",
        maxEntries: toUnifiIpSetMaxEntries(
          process.env.UNIFI_BLOCKLISTS_MAX_ENTRIES,
          DEFAULT_UNIFI_IPSET_MAX_ENTRIES,
        ),
        enabledField:
          process.env.UNIFI_BLOCKLISTS_ENABLED_FIELD || "",
        tagsField: process.env.UNIFI_BLOCKLISTS_TAGS_FIELD || "",
        managedTag:
          process.env.UNIFI_MANAGED_TAG || "managed-by-unifi-bl",
        extraPayload: parseJson(
          process.env.UNIFI_BLOCKLISTS_EXTRA_PAYLOAD,
          {},
        ),
      },
    },
  };

  if (config.allowInsecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  } else {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "1";
  }

  return config;
}
