import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BlocklistService,
  REFRESH_INTERVAL_OPTIONS,
} from "./lib/blocklists.js";
import { loadConfig } from "./lib/config.js";
import { HttpError } from "./lib/http-client.js";
import { InstallationIdentityService } from "./lib/installation-identity.js";
import { JsonStore } from "./lib/json-store.js";
import { BlocklistRefreshScheduler } from "./lib/refresh-scheduler.js";
import { RuntimeSettingsService } from "./lib/runtime-settings.js";
import { ServerTelemetryService } from "./lib/server-telemetry.js";
import { SessionAuthService } from "./lib/session-auth.js";
import { getUnifiIpSetMaxEntriesLabel } from "./lib/unifi-ipset.js";
import { UnifiApi } from "./lib/unifi-api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const config = loadConfig();
const store = new JsonStore(config.dataFile);
const installationIdentity = new InstallationIdentityService(config);
const runtimeSettings = new RuntimeSettingsService(config);
const unifiApi = new UnifiApi(config);
const telemetry = new ServerTelemetryService(config);
const auth = new SessionAuthService(config);
const blocklists = new BlocklistService(store, unifiApi, telemetry);
const refreshScheduler = new BlocklistRefreshScheduler(blocklists);

function pickPrimaryConsoleDevice(devices = []) {
  const gatewayModelPattern =
    /^(UCG|UDM|UCK|USG|UGW|UX)\b|Cloud Gateway|Cloud Key|Dream Machine|Express/i;

  return (
    devices.find((device) => gatewayModelPattern.test(String(device?.model || ""))) ||
    devices.find((device) => String(device?.state || "").toUpperCase() === "ONLINE") ||
    devices[0] ||
    null
  );
}

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...extraHeaders,
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response, statusCode, body, contentType, extraHeaders = {}) {
  response.writeHead(statusCode, {
    "content-type": contentType,
    ...extraHeaders,
  });
  response.end(body);
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new HttpError(413, "Request body too large.");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid JSON request body.");
  }
}

async function serveStatic(urlPath, response) {
  const relativePath =
    urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const safePath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(publicDir, safePath);

  let contentType = "text/plain; charset=utf-8";
  if (filePath.endsWith(".html")) {
    contentType = "text/html; charset=utf-8";
  } else if (filePath.endsWith(".css")) {
    contentType = "text/css; charset=utf-8";
  } else if (filePath.endsWith(".js")) {
    contentType = "text/javascript; charset=utf-8";
  } else if (filePath.endsWith(".svg")) {
    contentType = "image/svg+xml; charset=utf-8";
  }

  const content = await readFile(filePath, "utf8");
  sendText(response, 200, content, contentType, {
    "cache-control": "no-store",
  });
}

function safeConfig() {
  return {
    appTitle: config.appTitle,
    appVersion: config.appVersion,
    allowInsecureTls: config.allowInsecureTls,
    networkBaseUrl: config.unifi.networkBaseUrl,
    networkConfigured: unifiApi.isNetworkConfigured(),
    networkApiKeyConfigured: Boolean(config.unifi.networkApiKey),
    siteId: config.unifi.siteId,
    siteManagerConfigured: unifiApi.isSiteManagerConfigured(),
    siteManagerBaseUrl: config.unifi.siteManagerBaseUrl,
    siteManagerApiKeyConfigured: Boolean(config.unifi.siteManagerApiKey),
    blocklists: {
      listPath: config.unifi.blocklists.listPath,
      createPath: config.unifi.blocklists.createPath,
      updatePath: config.unifi.blocklists.updatePath,
      deletePath: config.unifi.blocklists.deletePath,
      maxEntries: config.unifi.blocklists.maxEntries,
      maxEntriesLabel: getUnifiIpSetMaxEntriesLabel(
        config.unifi.blocklists.maxEntries,
      ),
    },
    firewallRule: {
      listPath: config.unifi.firewallRule.listPath,
      createPath: config.unifi.firewallRule.createPath,
      updatePath: config.unifi.firewallRule.updatePath,
      deletePath: config.unifi.firewallRule.deletePath,
      managedName: config.unifi.firewallRule.managedName,
    },
    firewallPolicy: {
      listPath: config.unifi.firewallPolicy.listPath,
      createPath: config.unifi.firewallPolicy.createPath,
      updatePath: config.unifi.firewallPolicy.updatePath,
      deletePath: config.unifi.firewallPolicy.deletePath,
      zoneMatrixPath: config.unifi.firewallPolicy.zoneMatrixPath,
      managedName: config.unifi.firewallPolicy.managedName,
    },
    telemetry: {
      enabled: Boolean(config.telemetry?.enabled),
      projectApiKey: config.telemetry?.enabled ? config.telemetry.projectApiKey : "",
      host: config.telemetry?.host || "",
      defaults: config.telemetry?.defaults || "2026-01-30",
      identityMode: "browser-profile-installation",
      installationId: config.installation?.id || "",
      installationCreatedAt: config.installation?.createdAt || "",
      runningVersion: config.installation?.runningVersion || config.appVersion,
    },
    refreshIntervals: REFRESH_INTERVAL_OPTIONS,
  };
}

function publicTelemetryConfig({ includeProjectApiKey = false } = {}) {
  return {
    enabled: Boolean(config.telemetry?.enabled),
    projectApiKey:
      includeProjectApiKey && config.telemetry?.enabled
        ? config.telemetry.projectApiKey
        : "",
    host: config.telemetry?.host || "",
    defaults: config.telemetry?.defaults || "2026-01-30",
    identityMode: "browser-profile-installation",
    installationId: config.installation?.id || "",
    installationCreatedAt: config.installation?.createdAt || "",
    runningVersion: config.installation?.runningVersion || config.appVersion,
  };
}

async function buildLifecycleTelemetryProperties() {
  const currentBlocklists = await blocklists.list();

  return {
    allow_insecure_tls: Boolean(config.allowInsecureTls),
    network_configured: unifiApi.isNetworkConfigured(),
    site_manager_configured: unifiApi.isSiteManagerConfigured(),
    blocklist_count: currentBlocklists.length,
    enabled_blocklist_count: currentBlocklists.filter((item) => item.enabled !== false)
      .length,
    source_blocklist_count: currentBlocklists.filter((item) => item.sourceUrl).length,
    firewall_included_blocklist_count: currentBlocklists.filter(
      (item) => item.enabled !== false && item.includeInFirewall !== false,
    ).length,
  };
}

function buildSettingsTelemetryProperties(settings = {}) {
  return {
    allow_insecure_tls: Boolean(settings.allowInsecureTls),
    network_configured: Boolean(settings.unifi?.networkBaseUrl),
    network_api_key_configured: Boolean(settings.unifi?.networkApiKeyConfigured),
    site_id_configured: Boolean(settings.unifi?.siteId),
    site_manager_configured: Boolean(settings.unifi?.siteManagerBaseUrl),
    site_manager_api_key_configured: Boolean(
      settings.unifi?.siteManagerApiKeyConfigured,
    ),
    blocklists_max_entries: Number(settings.unifi?.blocklists?.maxEntries || 0),
  };
}

async function buildUnifiStatus() {
  const status = {
    timestamp: new Date().toISOString(),
    network: {
      ok: false,
      sitesCount: 0,
      devicesCount: 0,
      clientsCount: 0,
      selectedSiteId: config.unifi.siteId || "",
      consoleName: "",
      consoleModel: "",
      message: "",
    },
    siteManager: {
      ok: false,
      hostsCount: 0,
      message: "",
    },
  };

  if (unifiApi.isNetworkConfigured()) {
    try {
      const sites = await unifiApi.listSites();
      status.network.ok = true;
      status.network.sitesCount = sites.length;
      status.network.message = "Local API reachable";

      try {
        const siteId = await unifiApi.resolveSiteId();
        status.network.selectedSiteId = siteId;
        const [devices, clients] = await Promise.all([
          unifiApi.listDevices(siteId),
          unifiApi.listClients(siteId),
        ]);
        status.network.devicesCount = devices.length;
        status.network.clientsCount = clients.length;
        const primaryConsole = pickPrimaryConsoleDevice(devices);
        status.network.consoleName = String(primaryConsole?.name || "");
        status.network.consoleModel = String(primaryConsole?.model || "");
      } catch (error) {
        status.network.message = error.message;
      }
    } catch (error) {
      status.network.message = error.message;
    }
  } else {
    status.network.message = "UNIFI_NETWORK_BASE_URL / API_KEY missing";
  }

  if (unifiApi.isSiteManagerConfigured()) {
    try {
      const hosts = await unifiApi.listHosts();
      status.siteManager.ok = true;
      status.siteManager.hostsCount = hosts.length;
      status.siteManager.message = "Cloud API reachable";
    } catch (error) {
      status.siteManager.message = error.message;
    }
  } else {
    status.siteManager.message = "Site Manager API key missing";
  }

  return status;
}

async function handleApi(request, response, url) {
  const { pathname } = url;

  if (request.method === "GET" && pathname === "/api/health") {
    return sendJson(response, 200, {
      ok: true,
      now: new Date().toISOString(),
    });
  }

  if (request.method === "GET" && pathname === "/api/session") {
    const session = auth.getSessionFromRequest(request);
    return sendJson(response, 200, {
      session: auth.getPublicSession(session),
      app: {
        version: config.appVersion,
        telemetry: publicTelemetryConfig({
          includeProjectApiKey:
            !auth.isEnabled() || Boolean(auth.getSessionFromRequest(request)),
        }),
      },
    });
  }

  if (request.method === "POST" && pathname === "/api/auth/login") {
    const body = await readJsonBody(request);
    let result;

    try {
      result = auth.login(body, request);
    } catch (error) {
      telemetry.captureBackground("admin_login_failed", {
        auth_enabled: Boolean(config.auth?.enabled),
        error_class: String(error?.name || "Error"),
        http_status: Number.isInteger(error?.status) ? error.status : 0,
      });
      throw error;
    }

    telemetry.captureBackground("admin_login", {
      auth_enabled: Boolean(config.auth?.enabled),
      session_duration_hours: Number(result.session?.sessionDurationHours || 0),
    });

    return sendJson(
      response,
      200,
      {
        session: result.session,
      },
      {
        "set-cookie": result.setCookie,
      },
    );
  }

  if (request.method === "POST" && pathname === "/api/auth/logout") {
    const result = auth.logout(request);
    telemetry.captureBackground("admin_logout", {
      auth_enabled: Boolean(config.auth?.enabled),
    });
    return sendJson(
      response,
      200,
      {
        session: result.session,
      },
      {
        "set-cookie": result.setCookie,
      },
    );
  }

  if (auth.isEnabled()) {
    auth.requireSession(request);
  }

  if (request.method === "GET" && pathname === "/api/config") {
    return sendJson(response, 200, {
      config: safeConfig(),
    });
  }

  if (request.method === "GET" && pathname === "/api/settings") {
    return sendJson(response, 200, {
      settings: runtimeSettings.getSafeSettings(),
    });
  }

  if (request.method === "PUT" && pathname === "/api/settings") {
    const body = await readJsonBody(request);
    const settings = await runtimeSettings.updateFromPayload(body);
    telemetry.captureBackground("settings_saved", buildSettingsTelemetryProperties(settings));
    return sendJson(response, 200, {
      settings,
      config: safeConfig(),
    });
  }

  if (request.method === "GET" && pathname === "/api/blocklists") {
    return sendJson(response, 200, {
      blocklists: await blocklists.list(),
    });
  }

  if (request.method === "POST" && pathname === "/api/blocklists") {
    const body = await readJsonBody(request);
    const blocklist = await blocklists.createManaged(body, { origin: "api" });
    return sendJson(response, 201, { blocklist });
  }

  if (request.method === "POST" && pathname === "/api/blocklists/sync-all") {
    const results = await blocklists.syncAll({ origin: "api" });
    return sendJson(response, 200, { results });
  }

  const blocklistMatch = pathname.match(/^\/api\/blocklists\/([^/]+)$/);
  if (blocklistMatch && request.method === "PUT") {
    const body = await readJsonBody(request);
    const blocklist = await blocklists.updateManaged(blocklistMatch[1], body, {
      origin: "api",
    });
    return sendJson(response, 200, { blocklist });
  }

  if (blocklistMatch && request.method === "DELETE") {
    const result = await blocklists.removeManaged(blocklistMatch[1], {
      origin: "api",
    });
    return sendJson(response, 200, result);
  }

  const refreshStateMatch = pathname.match(
    /^\/api\/blocklists\/([^/]+)\/refresh-state$/,
  );
  if (refreshStateMatch && request.method === "PUT") {
    const body = await readJsonBody(request);
    const blocklist = await blocklists.setRefreshPaused(
      refreshStateMatch[1],
      body.paused,
    );
    return sendJson(response, 200, { blocklist });
  }

  const syncMatch = pathname.match(/^\/api\/blocklists\/([^/]+)\/sync$/);
  if (syncMatch && request.method === "POST") {
    try {
      const result = await blocklists.pushOne(syncMatch[1], { origin: "api" });
      return sendJson(response, 200, result);
    } catch (error) {
      await blocklists.markSyncFailure(syncMatch[1], error);
      throw error;
    }
  }

  const syncSourceMatch = pathname.match(/^\/api\/blocklists\/([^/]+)\/sync-source$/);
  if (syncSourceMatch && request.method === "POST") {
    try {
      const result = await blocklists.syncSource(syncSourceMatch[1], {
        origin: "api",
      });
      return sendJson(response, 200, result);
    } catch (error) {
      await blocklists.markSyncFailure(syncSourceMatch[1], error);
      throw error;
    }
  }

  const remoteDeleteMatch = pathname.match(/^\/api\/blocklists\/([^/]+)\/remote$/);
  if (remoteDeleteMatch && request.method === "DELETE") {
    const result = await blocklists.deleteRemote(remoteDeleteMatch[1], {
      origin: "api",
    });
    return sendJson(response, 200, result);
  }

  if (request.method === "GET" && pathname === "/api/unifi/test") {
    const status = await buildUnifiStatus();
    return sendJson(response, 200, { status });
  }

  if (request.method === "GET" && pathname === "/api/unifi/sites") {
    const sites = unifiApi.isNetworkConfigured()
      ? await unifiApi.listSites()
      : [];
    return sendJson(response, 200, { sites });
  }

  if (request.method === "GET" && pathname === "/api/unifi/remote-blocklists") {
    const site = await unifiApi.resolveSiteContext();
    const [remoteBlocklists, localBlocklists] = await Promise.all([
      unifiApi.listRemoteBlocklists(site),
      blocklists.list(),
    ]);
    const managedIds = new Set(
      localBlocklists.map((item) => item.remoteObjectId).filter(Boolean),
    );

    return sendJson(response, 200, {
      siteId: site.siteId,
      siteRef: site.siteRef,
      remoteBlocklists: remoteBlocklists.filter((item) => managedIds.has(item.id)),
    });
  }

  return sendJson(response, 404, {
    error: "API route not found.",
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    const status =
      error instanceof HttpError
        ? error.status
        : error.code === "ENOENT"
          ? 404
          : 500;
    const unauthorizedLoginState =
      status === 401 && url.pathname === "/api/auth/login" && auth.isEnabled()
        ? auth.getPublicSession(null)
        : null;
    const logoutState =
      status === 401 &&
      url.pathname.startsWith("/api/") &&
      url.pathname !== "/api/auth/login" &&
      auth.isEnabled()
        ? auth.logout(request)
        : null;

    sendJson(
      response,
      status,
      {
        error: error.message,
        details:
          error instanceof HttpError ? error.details ?? undefined : undefined,
        session: unauthorizedLoginState || logoutState?.session,
      },
      logoutState?.setCookie
        ? {
            "set-cookie": logoutState.setCookie,
          }
        : {},
    );
  }
});

await store.ensure();
installationIdentity.load();
await runtimeSettings.load();
refreshScheduler.start();

server.listen(config.port, () => {
  console.log(
    `[unifi_bl] ${config.appTitle} available at http://localhost:${config.port}`,
  );

  void (async () => {
    const lifecycleProperties = await buildLifecycleTelemetryProperties();
    telemetry.identifyInstallationBackground(lifecycleProperties);
    telemetry.captureBackground("instance_started", lifecycleProperties);
    telemetry.captureBackground("version_reported", {
      ...lifecycleProperties,
      reported_version:
        String(config.installation?.runningVersion || "").trim() || config.appVersion,
    });
    telemetry.startHeartbeat(buildLifecycleTelemetryProperties);
  })();
});
