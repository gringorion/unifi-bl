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

function loadPackageVersion(cwd) {
  try {
    const packageJsonPath = path.join(cwd, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return String(packageJson.version || "").trim() || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function buildAuthConfig({ username, password, passwordSeed }) {
  const requiredVariables = [
    "APP_AUTH_USERNAME",
    "APP_AUTH_PASSWORD",
    "APP_AUTH_PASSWORD_SEED",
  ];
  const configuredValues = [username, password, passwordSeed].filter(Boolean);

  if (configuredValues.length > 0 && configuredValues.length < requiredVariables.length) {
    throw new Error(
      "APP_AUTH_USERNAME, APP_AUTH_PASSWORD, and APP_AUTH_PASSWORD_SEED must all be set together or all be empty.",
    );
  }

  if (
    String(password || "").startsWith("sha256:") &&
    !/^[0-9a-f]{64}$/i.test(String(password || "").slice("sha256:".length).trim())
  ) {
    throw new Error(
      "APP_AUTH_PASSWORD must be a plain password or a sha256:<64-hex> seeded hash.",
    );
  }

  const enabled = Boolean(username && password && passwordSeed);
  const missingVariables = enabled ? [] : requiredVariables;

  return {
    enabled,
    username,
    password,
    passwordSeed,
    requiredVariables,
    missingVariables,
    inactiveReason: enabled
      ? ""
      : "Authentication is inactive because the required Docker environment variables are not configured.",
    activationHint: enabled
      ? ""
      : "Set APP_AUTH_USERNAME, APP_AUTH_PASSWORD, and APP_AUTH_PASSWORD_SEED in your Docker environment, then restart the container.",
  };
}

function buildDefaultFirewallRuleExtraPayload() {
  return {
    action: "drop",
    contiguous: false,
    dst_networkconf_id: "",
    icmp_typename: "",
    icmpv6_typename: "",
    ipsec: "match-none",
    logging: false,
    monthdays: "",
    monthdays_negate: false,
    protocol: "all",
    protocol_match_excepted: false,
    protocol_v6: "",
    setting_preference: "manual",
    src_mac_address: "",
    src_networkconf_id: "",
    startdate: "",
    starttime: "",
    state_established: false,
    state_invalid: false,
    state_new: false,
    state_related: false,
    stopdate: "",
    stoptime: "",
    utc: false,
    weekdays: "",
    weekdays_negate: false,
  };
}

function buildDefaultFirewallPolicyExtraPayload() {
  return {
    connection_state_type: "ALL",
    connection_states: [],
    create_allow_respond: false,
    description: "",
    icmp_typename: "ANY",
    icmp_v6_typename: "ANY",
    ip_version: "IPV4",
    logging: false,
    match_ip_sec: false,
    match_opposite_protocol: false,
    protocol: "all",
    schedule: {
      mode: "ALWAYS",
    },
  };
}

export function loadConfig() {
  loadDotEnvFile();
  const cwd = process.cwd();
  const appVersion = loadPackageVersion(cwd);
  const authUsername = String(process.env.APP_AUTH_USERNAME || "").trim();
  const authPassword = String(process.env.APP_AUTH_PASSWORD || "");
  const authPasswordSeed = String(process.env.APP_AUTH_PASSWORD_SEED || "");
  const auth = buildAuthConfig({
    username: authUsername,
    password: authPassword,
    passwordSeed: authPasswordSeed,
  });

  const config = {
    appTitle: process.env.APP_TITLE || "UniFi Blocklists",
    appVersion,
    port: toNumber(process.env.PORT, 8080),
    requestTimeoutMs: toNumber(process.env.REQUEST_TIMEOUT_MS, 15000),
    allowInsecureTls: toBoolean(process.env.ALLOW_INSECURE_TLS, false),
    dataFile:
      process.env.DATA_FILE || path.join(cwd, "data", "blocklists.json"),
    settingsFile:
      process.env.SETTINGS_FILE || path.join(cwd, "data", "settings.json"),
    auth,
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
      firewallRule: {
        listPath:
          process.env.UNIFI_FIREWALL_RULES_LIST_PATH ||
          "{networkRootUrl}/api/s/{siteRef}/rest/firewallrule",
        createPath:
          process.env.UNIFI_FIREWALL_RULES_CREATE_PATH ||
          "{networkRootUrl}/api/s/{siteRef}/rest/firewallrule",
        updatePath:
          process.env.UNIFI_FIREWALL_RULES_UPDATE_PATH ||
          "{networkRootUrl}/api/s/{siteRef}/rest/firewallrule/{id}",
        deletePath:
          process.env.UNIFI_FIREWALL_RULES_DELETE_PATH ||
          "{networkRootUrl}/api/s/{siteRef}/rest/firewallrule/{id}",
        createMethod:
          process.env.UNIFI_FIREWALL_RULES_CREATE_METHOD || "POST",
        updateMethod:
          process.env.UNIFI_FIREWALL_RULES_UPDATE_METHOD || "PUT",
        deleteMethod:
          process.env.UNIFI_FIREWALL_RULES_DELETE_METHOD || "DELETE",
        idField: process.env.UNIFI_FIREWALL_RULES_ID_FIELD || "_id",
        nameField: process.env.UNIFI_FIREWALL_RULES_NAME_FIELD || "name",
        enabledField:
          process.env.UNIFI_FIREWALL_RULES_ENABLED_FIELD || "enabled",
        sourceGroupsField:
          process.env.UNIFI_FIREWALL_RULES_SOURCE_GROUPS_FIELD ||
          "src_firewallgroup_ids",
        destinationGroupsField:
          process.env.UNIFI_FIREWALL_RULES_DESTINATION_GROUPS_FIELD ||
          "dst_firewallgroup_ids",
        managedName:
          process.env.UNIFI_FIREWALL_RULE_NAME ||
          "unifi-bl - block enabled lists",
        extraPayload: parseJson(
          process.env.UNIFI_FIREWALL_RULES_EXTRA_PAYLOAD,
          buildDefaultFirewallRuleExtraPayload(),
        ),
      },
      firewallPolicy: {
        listPath:
          process.env.UNIFI_FIREWALL_POLICIES_LIST_PATH ||
          "{networkRootUrl}/v2/api/site/{siteRef}/firewall-policies",
        createPath:
          process.env.UNIFI_FIREWALL_POLICIES_CREATE_PATH ||
          "{networkRootUrl}/v2/api/site/{siteRef}/firewall-policies",
        updatePath:
          process.env.UNIFI_FIREWALL_POLICIES_UPDATE_PATH ||
          "{networkRootUrl}/v2/api/site/{siteRef}/firewall-policies/{id}",
        deletePath:
          process.env.UNIFI_FIREWALL_POLICIES_DELETE_PATH ||
          "{networkRootUrl}/v2/api/site/{siteRef}/firewall-policies/{id}",
        zoneMatrixPath:
          process.env.UNIFI_FIREWALL_POLICIES_ZONE_MATRIX_PATH ||
          "{networkRootUrl}/v2/api/site/{siteRef}/firewall/zone-matrix",
        createMethod:
          process.env.UNIFI_FIREWALL_POLICIES_CREATE_METHOD || "POST",
        updateMethod:
          process.env.UNIFI_FIREWALL_POLICIES_UPDATE_METHOD || "PUT",
        deleteMethod:
          process.env.UNIFI_FIREWALL_POLICIES_DELETE_METHOD || "DELETE",
        idField:
          process.env.UNIFI_FIREWALL_POLICIES_ID_FIELD || "_id",
        nameField:
          process.env.UNIFI_FIREWALL_POLICIES_NAME_FIELD || "name",
        enabledField:
          process.env.UNIFI_FIREWALL_POLICIES_ENABLED_FIELD || "enabled",
        managedName:
          process.env.UNIFI_FIREWALL_POLICY_NAME ||
          process.env.UNIFI_FIREWALL_RULE_NAME ||
          "unifi-bl - block enabled lists",
        extraPayload: parseJson(
          process.env.UNIFI_FIREWALL_POLICIES_EXTRA_PAYLOAD,
          buildDefaultFirewallPolicyExtraPayload(),
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
