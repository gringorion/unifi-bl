import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { HttpError } from "./http-client.js";
import {
  DEFAULT_UNIFI_IPSET_MAX_ENTRIES,
  UNIFI_IPSET_MAX_ENTRIES_OPTIONS,
  isSupportedUnifiIpSetMaxEntries,
  toUnifiIpSetMaxEntries,
} from "./unifi-ipset.js";

function trimTrailingSlash(value) {
  return String(value ?? "").trim().replace(/\/+$/, "");
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function defaultSettings() {
  return {
    allowInsecureTls: null,
    unifi: {
      networkBaseUrl: null,
      networkApiKey: null,
      siteId: null,
      siteManagerBaseUrl: null,
      siteManagerApiKey: null,
      blocklists: {
        maxEntries: null,
      },
    },
  };
}

function normalizeStoredSettings(payload = {}) {
  return {
    allowInsecureTls:
      payload.allowInsecureTls === null || payload.allowInsecureTls === undefined
        ? null
        : Boolean(payload.allowInsecureTls),
    unifi: {
      networkBaseUrl:
        payload.unifi?.networkBaseUrl === null ||
        payload.unifi?.networkBaseUrl === undefined
          ? null
          : trimTrailingSlash(payload.unifi?.networkBaseUrl || ""),
      networkApiKey:
        payload.unifi?.networkApiKey === null ||
        payload.unifi?.networkApiKey === undefined
          ? null
          : String(payload.unifi?.networkApiKey || ""),
      siteId:
        payload.unifi?.siteId === null || payload.unifi?.siteId === undefined
          ? null
          : String(payload.unifi?.siteId || "").trim(),
      siteManagerBaseUrl:
        payload.unifi?.siteManagerBaseUrl === null ||
        payload.unifi?.siteManagerBaseUrl === undefined
          ? null
          : trimTrailingSlash(payload.unifi?.siteManagerBaseUrl || ""),
      siteManagerApiKey:
        payload.unifi?.siteManagerApiKey === null ||
        payload.unifi?.siteManagerApiKey === undefined
          ? null
          : String(payload.unifi?.siteManagerApiKey || ""),
      blocklists: {
        maxEntries:
          payload.unifi?.blocklists?.maxEntries === null ||
          payload.unifi?.blocklists?.maxEntries === undefined
            ? null
            : toUnifiIpSetMaxEntries(
                payload.unifi?.blocklists?.maxEntries,
                DEFAULT_UNIFI_IPSET_MAX_ENTRIES,
              ),
      },
    },
  };
}

export class RuntimeSettingsService {
  constructor(config) {
    this.config = config;
    this.filePath = config.settingsFile;
  }

  async ensure() {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await writeFile(
        this.filePath,
        JSON.stringify(defaultSettings(), null, 2),
        "utf8",
      );
    }
  }

  async readStoredSettings() {
    await this.ensure();
    const raw = await readFile(this.filePath, "utf8");
    return normalizeStoredSettings(JSON.parse(raw || "{}"));
  }

  async writeStoredSettings(settings) {
    await this.ensure();
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(settings, null, 2), "utf8");
    await rename(tmpPath, this.filePath);
  }

  applyStoredSettings(settings) {
    const normalized = normalizeStoredSettings(settings);

    if (normalized.allowInsecureTls !== null) {
      this.config.allowInsecureTls = normalized.allowInsecureTls;
    }

    if (normalized.unifi.networkBaseUrl !== null) {
      this.config.unifi.networkBaseUrl = normalized.unifi.networkBaseUrl;
    }

    if (normalized.unifi.networkApiKey !== null) {
      this.config.unifi.networkApiKey = normalized.unifi.networkApiKey;
    }

    if (normalized.unifi.siteId !== null) {
      this.config.unifi.siteId = normalized.unifi.siteId;
    }

    if (normalized.unifi.siteManagerBaseUrl !== null) {
      this.config.unifi.siteManagerBaseUrl = normalized.unifi.siteManagerBaseUrl;
    }

    if (normalized.unifi.siteManagerApiKey !== null) {
      this.config.unifi.siteManagerApiKey = normalized.unifi.siteManagerApiKey;
    }

    if (normalized.unifi.blocklists.maxEntries !== null) {
      this.config.unifi.blocklists.maxEntries =
        normalized.unifi.blocklists.maxEntries;
    }

    process.env.NODE_TLS_REJECT_UNAUTHORIZED = this.config.allowInsecureTls
      ? "0"
      : "1";
  }

  async load() {
    const settings = await this.readStoredSettings();
    this.applyStoredSettings(settings);
    return settings;
  }

  getSafeSettings() {
    return {
      allowInsecureTls: this.config.allowInsecureTls,
      unifi: {
        networkBaseUrl: this.config.unifi.networkBaseUrl,
        networkApiKeyConfigured: Boolean(this.config.unifi.networkApiKey),
        siteId: this.config.unifi.siteId,
        siteManagerBaseUrl: this.config.unifi.siteManagerBaseUrl,
        siteManagerApiKeyConfigured: Boolean(
          this.config.unifi.siteManagerApiKey,
        ),
        blocklists: {
          maxEntries: this.config.unifi.blocklists.maxEntries,
          maxEntriesOptions: UNIFI_IPSET_MAX_ENTRIES_OPTIONS,
        },
      },
    };
  }

  async updateFromPayload(payload = {}) {
    const current = await this.readStoredSettings();

    const next = {
      allowInsecureTls:
        payload.allowInsecureTls === undefined
          ? current.allowInsecureTls
          : toBoolean(payload.allowInsecureTls, false),
      unifi: {
        networkBaseUrl:
          payload.unifi?.networkBaseUrl === undefined
            ? current.unifi.networkBaseUrl
            : trimTrailingSlash(payload.unifi?.networkBaseUrl || ""),
        networkApiKey: current.unifi.networkApiKey,
        siteId:
          payload.unifi?.siteId === undefined
            ? current.unifi.siteId
            : String(payload.unifi?.siteId || "").trim(),
        siteManagerBaseUrl:
          payload.unifi?.siteManagerBaseUrl === undefined
            ? current.unifi.siteManagerBaseUrl
            : trimTrailingSlash(payload.unifi?.siteManagerBaseUrl || ""),
        siteManagerApiKey: current.unifi.siteManagerApiKey,
        blocklists: {
          maxEntries:
            payload.unifi?.blocklists?.maxEntries === undefined
              ? current.unifi.blocklists.maxEntries
              : this.normalizeIpSetMaxEntries(payload.unifi?.blocklists?.maxEntries),
        },
      },
    };

    if (payload.unifi?.clearNetworkApiKey) {
      next.unifi.networkApiKey = "";
    } else if (String(payload.unifi?.networkApiKey || "").trim()) {
      next.unifi.networkApiKey = String(payload.unifi.networkApiKey).trim();
    }

    if (payload.unifi?.clearSiteManagerApiKey) {
      next.unifi.siteManagerApiKey = "";
    } else if (String(payload.unifi?.siteManagerApiKey || "").trim()) {
      next.unifi.siteManagerApiKey = String(
        payload.unifi.siteManagerApiKey,
      ).trim();
    }

    await this.writeStoredSettings(next);
    this.applyStoredSettings(next);

    return this.getSafeSettings();
  }

  normalizeIpSetMaxEntries(value) {
    const normalized = Number(value);

    if (!Number.isInteger(normalized) || !isSupportedUnifiIpSetMaxEntries(normalized)) {
      throw new HttpError(
        400,
        `Invalid UniFi IP set max. Allowed values: ${UNIFI_IPSET_MAX_ENTRIES_OPTIONS.map((option) => option.value).join(", ")}`,
      );
    }

    return normalized;
  }
}
