import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

function nowIso() {
  return new Date().toISOString();
}

function isNonEmptyString(value) {
  return Boolean(String(value || "").trim());
}

function normalizeStoredInstallation(payload = {}) {
  return {
    id: isNonEmptyString(payload?.id) ? String(payload.id).trim() : "",
    createdAt: isNonEmptyString(payload?.createdAt)
      ? String(payload.createdAt).trim()
      : "",
  };
}

export class InstallationIdentityService {
  constructor(config) {
    this.config = config;
    this.filePath = config.installationFile;
  }

  load() {
    mkdirSync(path.dirname(this.filePath), { recursive: true });

    let stored = {};
    if (existsSync(this.filePath)) {
      try {
        stored = JSON.parse(readFileSync(this.filePath, "utf8") || "{}");
      } catch {
        stored = {};
      }
    }

    const normalized = normalizeStoredInstallation(stored);
    const createdAt = normalized.createdAt || nowIso();
    const metadata = {
      id: normalized.id || `unifi-bl-installation:${randomUUID()}`,
      createdAt,
      lastStartedAt: nowIso(),
      runningVersion: this.config.appVersion,
    };

    writeFileSync(this.filePath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    this.config.installation = metadata;

    return metadata;
  }
}
