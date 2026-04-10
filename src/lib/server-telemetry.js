const DEFAULT_HEARTBEAT_INTERVAL_MS = 6 * 60 * 60 * 1000;
const CAPTURE_PATH = "/i/v0/e/";
const REQUEST_TIMEOUT_MS = 5000;
const FAILURE_LOG_THROTTLE_MS = 30 * 60 * 1000;

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function nowIso() {
  return new Date().toISOString();
}

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withoutUndefinedEntries(payload = {}) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined),
  );
}

function buildEventEndpoint(host) {
  return `${trimTrailingSlash(host)}${CAPTURE_PATH}`;
}

export class ServerTelemetryService {
  constructor(config, options = {}) {
    this.config = config;
    this.fetchImpl = options.fetchImpl || globalThis.fetch?.bind(globalThis) || null;
    this.logger = options.logger || console;
    this.startedAt = Date.now();
    this.heartbeatIntervalMs = toFiniteNumber(
      options.heartbeatIntervalMs,
      DEFAULT_HEARTBEAT_INTERVAL_MS,
    );
    this.heartbeatTimer = null;
    this.lastFailureSignature = "";
    this.lastFailureLoggedAt = 0;
  }

  isEnabled() {
    return Boolean(
      this.fetchImpl &&
        this.config.telemetry?.enabled &&
        this.config.telemetry?.projectApiKey &&
        this.config.telemetry?.host,
    );
  }

  baseProperties(properties = {}) {
    const installationId = String(this.config.installation?.id || "").trim();
    const runningVersion =
      String(this.config.installation?.runningVersion || "").trim() ||
      String(this.config.appVersion || "").trim();

    return withoutUndefinedEntries({
      telemetry_source: "server",
      telemetry_scope: "installation",
      app_name: "unifi_bl",
      app_title: String(this.config.appTitle || ""),
      app_version: String(this.config.appVersion || ""),
      running_version: runningVersion,
      installation_id: installationId,
      installation_created_at: String(this.config.installation?.createdAt || ""),
      auth_enabled: Boolean(this.config.auth?.enabled),
      uptime_seconds: Math.max(0, Math.floor((Date.now() - this.startedAt) / 1000)),
      $groups: installationId ? { installation: installationId } : undefined,
      ...properties,
    });
  }

  async sendPayload(payload) {
    if (!this.isEnabled()) {
      return false;
    }

    const response = await this.fetchImpl(buildEventEndpoint(this.config.telemetry.host), {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(
        `PostHog capture failed with status ${response.status}${body ? `: ${body}` : ""}`,
      );
    }

    this.lastFailureSignature = "";
    this.lastFailureLoggedAt = 0;
    return true;
  }

  logFailure(prefix, error) {
    const signature = `${prefix}:${error?.name || "Error"}:${error?.message || ""}`;
    const now = Date.now();

    if (
      signature === this.lastFailureSignature &&
      now - this.lastFailureLoggedAt < FAILURE_LOG_THROTTLE_MS
    ) {
      return;
    }

    this.lastFailureSignature = signature;
    this.lastFailureLoggedAt = now;
    this.logger.warn?.(prefix, error);
  }

  async capture(eventName, properties = {}, options = {}) {
    if (!this.isEnabled()) {
      return false;
    }

    const distinctId =
      String(options.distinctId || "").trim() ||
      String(this.config.installation?.id || "").trim() ||
      "unifi-bl-installation:unknown";
    const timestamp = String(options.timestamp || nowIso());

    try {
      return await this.sendPayload({
        api_key: this.config.telemetry.projectApiKey,
        event: String(eventName || "").trim(),
        distinct_id: distinctId,
        properties: this.baseProperties(properties),
        timestamp,
      });
    } catch (error) {
      this.logFailure("[unifi_bl] PostHog capture failed", error);
      return false;
    }
  }

  captureBackground(eventName, properties = {}, options = {}) {
    void this.capture(eventName, properties, options);
  }

  async identifyInstallation(properties = {}) {
    if (!this.isEnabled()) {
      return false;
    }

    const installationId = String(this.config.installation?.id || "").trim();
    if (!installationId) {
      return false;
    }

    try {
      return await this.sendPayload({
        api_key: this.config.telemetry.projectApiKey,
        event: "$groupidentify",
        distinct_id: installationId,
        properties: {
          $group_type: "installation",
          $group_key: installationId,
          $group_set: withoutUndefinedEntries({
            app_name: "unifi_bl",
            app_title: String(this.config.appTitle || ""),
            app_version: String(this.config.appVersion || ""),
            running_version:
              String(this.config.installation?.runningVersion || "").trim() ||
              String(this.config.appVersion || "").trim(),
            installation_id: installationId,
            installation_created_at: String(
              this.config.installation?.createdAt || "",
            ),
            auth_enabled: Boolean(this.config.auth?.enabled),
            ...properties,
          }),
        },
      });
    } catch (error) {
      this.logFailure("[unifi_bl] PostHog group identify failed", error);
      return false;
    }
  }

  identifyInstallationBackground(properties = {}) {
    void this.identifyInstallation(properties);
  }

  startHeartbeat(buildProperties = null) {
    if (!this.isEnabled() || this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      void (async () => {
        const extraProperties =
          typeof buildProperties === "function"
            ? await buildProperties()
            : {};
        await this.capture("heartbeat", extraProperties);
      })();
    }, this.heartbeatIntervalMs);

    this.heartbeatTimer.unref?.();
  }

  stopHeartbeat() {
    if (!this.heartbeatTimer) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }
}

export { DEFAULT_HEARTBEAT_INTERVAL_MS };
