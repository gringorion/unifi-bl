import {
  HttpError,
  applyTemplate,
  getByPath,
  requestJson,
  setByPath,
  unwrapList,
  unwrapObject,
} from "./http-client.js";

function getPrimaryId(item) {
  return (
    item?.id ||
    item?.siteId ||
    item?._id ||
    item?.uid ||
    item?.name ||
    ""
  );
}

function getPrimaryName(item) {
  return item?.displayName || item?.name || item?.desc || getPrimaryId(item);
}

function getSiteReference(site) {
  return String(
    site?.internalReference || site?.name || site?.desc || getPrimaryId(site),
  );
}

function normalizeRemoteCidrs(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === "string") {
        return entry;
      }

      if (!entry || typeof entry !== "object") {
        return "";
      }

      return (
        entry.cidr ||
        entry.value ||
        entry.address ||
        entry.ip ||
        entry.network ||
        ""
      );
    })
    .filter(Boolean)
    .map((entry) => String(entry));
}

function normalizeRemoteIds(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (typeof entry === "string" || typeof entry === "number") {
        return String(entry);
      }

      if (!entry || typeof entry !== "object") {
        return "";
      }

      return (
        entry.id ||
        entry._id ||
        entry.uid ||
        entry.value ||
        entry.group_id ||
        entry.groupId ||
        entry.firewallgroup_id ||
        entry.firewallGroupId ||
        ""
      );
    })
    .filter(Boolean)
    .map((entry) => String(entry));
}

function normalizeManagedFirewallGroups(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const groups = [];
  const seen = new Set();

  for (const entry of value) {
    const group =
      typeof entry === "string" || typeof entry === "number"
        ? { id: String(entry), name: "" }
        : entry && typeof entry === "object"
          ? {
              id: String(
                entry.id ||
                  entry._id ||
                  entry.uid ||
                  entry.group_id ||
                  entry.groupId ||
                  entry.firewallgroup_id ||
                  "",
              ).trim(),
              name: String(entry.name || "").trim(),
            }
          : null;

    if (!group?.id || seen.has(group.id)) {
      continue;
    }

    seen.add(group.id);
    groups.push(group);
  }

  return groups;
}

function attachManagedFirewallSyncSummary(items, summary = {}) {
  const normalizedItems = Array.isArray(items) ? items : [];

  return Object.assign(normalizedItems, {
    summary: {
      mode: String(summary.mode || "").trim(),
      createdCount: Number(summary.createdCount || 0),
      updatedCount: Number(summary.updatedCount || 0),
      deletedCount: Number(summary.deletedCount || 0),
      desiredCount: Number(summary.desiredCount || 0),
      activeCount: normalizedItems.length,
    },
  });
}

function normalizeRemoteFirewallZones(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  const zones = [];
  const seen = new Set();

  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }

    const zone = {
      id: getRemoteFirewallZoneId(entry),
      name: getRemoteFirewallZoneName(entry),
      key: getRemoteFirewallZoneKey(entry),
    };

    if (!zone.id || seen.has(zone.id)) {
      continue;
    }

    seen.add(zone.id);
    zones.push(zone);
  }

  return zones;
}

function getRemoteBlocklistId(item, configuredId) {
  return String(
    configuredId ||
      item?.id ||
      item?._id ||
      item?.uid ||
      item?.objectId ||
      item?.object_id ||
      "",
  );
}

function getRemoteBlocklistName(item, configuredName) {
  return String(configuredName || getPrimaryName(item) || "");
}

function getRemoteBlocklistDescription(item, configuredDescription) {
  return String(
    configuredDescription || item?.description || item?.desc || item?.comment || "",
  );
}

function getRemoteBlocklistCidrs(item, configuredCidrs) {
  const cidrs = normalizeRemoteCidrs(configuredCidrs);
  if (cidrs.length > 0) {
    return cidrs;
  }

  return normalizeRemoteCidrs(
    item?.cidrs ||
      item?.entries ||
      item?.members ||
      item?.group_members ||
      item?.groupMembers ||
      item?.addresses ||
      item?.networks,
  );
}

function getRemoteFirewallRuleId(item, configuredId) {
  return String(
    configuredId ||
      item?.id ||
      item?._id ||
      item?.uid ||
      item?.rule_id ||
      item?.ruleId ||
      "",
  );
}

function getRemoteFirewallRuleName(item, configuredName) {
  return String(configuredName || getPrimaryName(item) || "");
}

function getRemoteFirewallRuleSourceGroupIds(item, configuredSourceGroups) {
  const sourceGroupIds = normalizeRemoteIds(configuredSourceGroups);
  if (sourceGroupIds.length > 0) {
    return sourceGroupIds;
  }

  return normalizeRemoteIds(
    item?.src_firewallgroup_ids ||
      item?.srcFirewallGroupIds ||
      item?.source_groups ||
      item?.sourceGroupIds ||
      item?.sources,
  );
}

function getRemoteFirewallRuleDestinationGroupIds(item, configuredDestinationGroups) {
  const destinationGroupIds = normalizeRemoteIds(configuredDestinationGroups);
  if (destinationGroupIds.length > 0) {
    return destinationGroupIds;
  }

  return normalizeRemoteIds(
    item?.dst_firewallgroup_ids ||
      item?.dstFirewallGroupIds ||
      item?.destination_groups ||
      item?.destinationGroupIds ||
      item?.destinations,
  );
}

function getRemoteFirewallRuleRuleset(item) {
  return String(item?.ruleset || item?.rule_set || item?.ruleSet || "")
    .trim()
    .toUpperCase();
}

function getRemoteFirewallPolicyId(item, configuredId) {
  return String(configuredId || item?.id || item?._id || item?.uid || "");
}

function getRemoteFirewallPolicyName(item, configuredName) {
  return String(configuredName || getPrimaryName(item) || "");
}

function getRemoteFirewallZoneId(item) {
  return String(item?.id || item?._id || item?.uid || "");
}

function getRemoteFirewallZoneName(item) {
  return String(item?.name || item?.displayName || item?.desc || "")
    .trim();
}

function getRemoteFirewallZoneKey(item) {
  return String(item?.zone_key || item?.zoneKey || item?.key || "")
    .trim()
    .toLowerCase();
}

function buildManagedFirewallRuleName(managedName, directionLabel, group, index) {
  const identifier = String(group?.name || group?.id || index + 1).trim() || String(index + 1);
  const prefix = `${managedName} - ${directionLabel} - `;
  const rawName = `${prefix}${identifier}`;

  if (rawName.length <= 128) {
    return rawName;
  }

  return `${prefix}${identifier.slice(-(128 - prefix.length))}`;
}

function buildManagedFirewallPolicyName(
  managedName,
  directionLabel,
  zone,
  group,
  index,
) {
  const zoneLabel = String(zone?.key || zone?.name || "").trim() || "zone";
  const identifier = String(group?.name || group?.id || index + 1).trim() || String(index + 1);
  const prefix = `${managedName} - ${directionLabel} - ${zoneLabel} - `;
  const rawName = `${prefix}${identifier}`;

  if (rawName.length <= 128) {
    return rawName;
  }

  return `${prefix}${identifier.slice(-(128 - prefix.length))}`;
}

function normalizeRemotePayloadCidrs(cidrs, fields) {
  if (!Array.isArray(cidrs)) {
    return [];
  }

  if (fields.cidrsField === "group_members") {
    return cidrs.map((entry) =>
      typeof entry === "string" && entry.endsWith("/32")
        ? entry.slice(0, -3)
        : entry,
    );
  }

  return cidrs;
}

function pickRemoteObject(payload, expectedName = "") {
  const candidates = [];
  const objectCandidate = unwrapObject(payload);
  const listCandidate = unwrapList(payload);

  if (Array.isArray(objectCandidate)) {
    candidates.push(...objectCandidate);
  } else if (objectCandidate && typeof objectCandidate === "object") {
    candidates.push(objectCandidate);
  }

  if (Array.isArray(listCandidate)) {
    candidates.push(...listCandidate);
  }

  if (Array.isArray(payload)) {
    candidates.push(...payload);
  } else if (payload && typeof payload === "object") {
    candidates.push(payload);
  }

  const objects = candidates.filter(
    (candidate) => candidate && typeof candidate === "object" && !Array.isArray(candidate),
  );

  if (!expectedName) {
    return objects[0] || null;
  }

  return (
    objects.find((candidate) => getPrimaryName(candidate) === expectedName) ||
    objects[0] ||
    null
  );
}

function wrapBlocklistEndpointError(error, path, envKey) {
  if (!(error instanceof HttpError)) {
    return error;
  }

  let hint = `Check ${envKey}.`;
  if (error.status === 404) {
    hint = `The blocklist endpoint was not found on this controller. Check ${envKey}.`;
  } else if (error.status === 405) {
    hint = `The HTTP method is not allowed by this endpoint. Check ${envKey} and its configured method.`;
  } else if (error.status === 401 || error.status === 403) {
    hint = "UniFi denied access. Check the API key and its permissions.";
  }

  return new HttpError(
    error.status,
    `${error.message} | ${hint} | path=${path}`,
    error.details,
  );
}

function wrapFirewallRuleEndpointError(error, path, envKey) {
  if (!(error instanceof HttpError)) {
    return error;
  }

  let hint = `Check ${envKey}.`;
  if (error.status === 404) {
    hint = `The firewall rule endpoint was not found on this controller. Check ${envKey}.`;
  } else if (error.status === 405) {
    hint = `The HTTP method is not allowed by this endpoint. Check ${envKey} and its configured method.`;
  } else if (error.status === 401 || error.status === 403) {
    hint = "UniFi denied access. Check the API key and its permissions.";
  }

  return new HttpError(
    error.status,
    `${error.message} | ${hint} | path=${path}`,
    error.details,
  );
}

function wrapFirewallPolicyEndpointError(error, path, envKey) {
  if (!(error instanceof HttpError)) {
    return error;
  }

  let hint = `Check ${envKey}.`;
  if (error.status === 404) {
    hint = `The firewall policy endpoint was not found on this controller. Check ${envKey}.`;
  } else if (error.status === 405) {
    hint = `The HTTP method is not allowed by this endpoint. Check ${envKey} and its configured method.`;
  } else if (error.status === 401 || error.status === 403) {
    hint = "UniFi denied access. Check the API key and its permissions.";
  }

  return new HttpError(
    error.status,
    `${error.message} | ${hint} | path=${path}`,
    error.details,
  );
}

function isUnsupportedFirewallPolicyEndpointError(error) {
  return error instanceof HttpError && [404, 405].includes(error.status);
}

export class UnifiApi {
  constructor(config) {
    this.config = config;
  }

  isNetworkConfigured() {
    return Boolean(
      this.config.unifi.networkBaseUrl && this.config.unifi.networkApiKey,
    );
  }

  isSiteManagerConfigured() {
    return Boolean(
      this.config.unifi.siteManagerBaseUrl &&
        this.config.unifi.siteManagerApiKey,
    );
  }

  getNetworkHeaders() {
    return {
      "X-API-Key": this.config.unifi.networkApiKey,
    };
  }

  getSiteManagerHeaders() {
    return {
      "X-API-Key": this.config.unifi.siteManagerApiKey,
    };
  }

  async networkRequest(path, options = {}) {
    if (!this.isNetworkConfigured()) {
      throw new Error("Configuration UniFi Network incomplete.");
    }

    return requestJson({
      baseUrl: this.config.unifi.networkBaseUrl,
      path,
      timeoutMs: this.config.requestTimeoutMs,
      headers: this.getNetworkHeaders(),
      ...options,
    });
  }

  async siteManagerRequest(path, options = {}) {
    if (!this.isSiteManagerConfigured()) {
      throw new Error("Configuration Site Manager incomplete.");
    }

    return requestJson({
      baseUrl: this.config.unifi.siteManagerBaseUrl,
      path,
      timeoutMs: this.config.requestTimeoutMs,
      headers: this.getSiteManagerHeaders(),
      ...options,
    });
  }

  async listSites() {
    const response = await this.networkRequest("/sites");
    return unwrapList(response.data).map((site) => ({
      id: getPrimaryId(site),
      name: getPrimaryName(site),
      internalReference: getSiteReference(site),
      raw: site,
    }));
  }

  async listDevices(siteId) {
    const response = await this.networkRequest(`/sites/${siteId}/devices`);
    return unwrapList(response.data);
  }

  async listClients(siteId) {
    const response = await this.networkRequest(`/sites/${siteId}/clients`);
    return unwrapList(response.data);
  }

  async listHosts() {
    const response = await this.siteManagerRequest("/hosts");
    return unwrapList(response.data);
  }

  getNetworkRootUrl() {
    return String(this.config.unifi.networkBaseUrl || "").replace(
      /\/integration\/v1\/?$/,
      "",
    );
  }

  buildBlocklistPath(template, siteContext, remoteId = "") {
    const context =
      typeof siteContext === "string"
        ? { siteId: siteContext, siteRef: siteContext }
        : siteContext || {};

    return applyTemplate(String(template), {
      siteId: context.siteId || "",
      siteRef: context.siteRef || context.siteId || "",
      id: remoteId,
    }).replaceAll("{networkRootUrl}", this.getNetworkRootUrl());
  }

  mapRemoteBlocklist(item) {
    const fields = this.config.unifi.blocklists;
    const configuredId = getByPath(item, fields.idField);
    const configuredName = getByPath(item, fields.nameField);
    const configuredDescription = getByPath(item, fields.descriptionField);
    const configuredCidrs = getByPath(item, fields.cidrsField);
    const configuredEnabled = fields.enabledField
      ? getByPath(item, fields.enabledField)
      : undefined;

    return {
      id: getRemoteBlocklistId(item, configuredId),
      name: getRemoteBlocklistName(item, configuredName),
      description: getRemoteBlocklistDescription(item, configuredDescription),
      enabled:
        fields.enabledField === ""
          ? true
          : configuredEnabled === undefined
            ? true
            : Boolean(configuredEnabled),
      cidrs: getRemoteBlocklistCidrs(item, configuredCidrs),
      raw: item,
    };
  }

  mapRemoteFirewallRule(item) {
    const fields = this.config.unifi.firewallRule;
    const configuredId = getByPath(item, fields.idField);
    const configuredName = getByPath(item, fields.nameField);
    const configuredEnabled = fields.enabledField
      ? getByPath(item, fields.enabledField)
      : undefined;
    const configuredSourceGroups = fields.sourceGroupsField
      ? getByPath(item, fields.sourceGroupsField)
      : undefined;
    const configuredDestinationGroups = fields.destinationGroupsField
      ? getByPath(item, fields.destinationGroupsField)
      : undefined;

    return {
      id: getRemoteFirewallRuleId(item, configuredId),
      name: getRemoteFirewallRuleName(item, configuredName),
      enabled:
        fields.enabledField === ""
          ? true
          : configuredEnabled === undefined
            ? true
            : Boolean(configuredEnabled),
      sourceGroupIds: getRemoteFirewallRuleSourceGroupIds(
        item,
        configuredSourceGroups,
      ),
      destinationGroupIds: getRemoteFirewallRuleDestinationGroupIds(
        item,
        configuredDestinationGroups,
      ),
      ruleset: getRemoteFirewallRuleRuleset(item),
      raw: item,
    };
  }

  mapRemoteFirewallPolicy(item) {
    const fields = this.config.unifi.firewallPolicy;
    const configuredId = getByPath(item, fields.idField);
    const configuredName = getByPath(item, fields.nameField);
    const configuredEnabled = fields.enabledField
      ? getByPath(item, fields.enabledField)
      : undefined;

    return {
      id: getRemoteFirewallPolicyId(item, configuredId),
      name: getRemoteFirewallPolicyName(item, configuredName),
      enabled:
        fields.enabledField === ""
          ? true
          : configuredEnabled === undefined
            ? true
            : Boolean(configuredEnabled),
      action: String(item?.action || "").trim().toUpperCase(),
      protocol: String(item?.protocol || "").trim().toLowerCase(),
      ipVersion: String(item?.ip_version || item?.ipVersion || "")
        .trim()
        .toUpperCase(),
      index: Number.isInteger(item?.index)
        ? item.index
        : Number.isFinite(Number(item?.index))
          ? Number(item.index)
          : null,
      predefined: Boolean(item?.predefined),
      source:
        item?.source && typeof item.source === "object"
          ? structuredClone(item.source)
          : {},
      destination:
        item?.destination && typeof item.destination === "object"
          ? structuredClone(item.destination)
          : {},
      raw: item,
    };
  }

  buildRemotePayload(blocklist) {
    const fields = this.config.unifi.blocklists;
    const payload = structuredClone(fields.extraPayload || {});
    const remoteCidrs = normalizeRemotePayloadCidrs(blocklist.cidrs, fields);

    if (fields.nameField) {
      setByPath(payload, fields.nameField, blocklist.name);
    }

    if (fields.descriptionField) {
      setByPath(payload, fields.descriptionField, blocklist.description);
    }

    if (fields.cidrsField) {
      setByPath(payload, fields.cidrsField, remoteCidrs);
    }

    if (fields.enabledField) {
      setByPath(payload, fields.enabledField, blocklist.enabled);
    }

    if (fields.tagsField) {
      const tags = Array.isArray(getByPath(payload, fields.tagsField))
        ? getByPath(payload, fields.tagsField)
        : [];
      const mergedTags = Array.from(
        new Set([...tags, fields.managedTag].filter(Boolean)),
      );
      setByPath(payload, fields.tagsField, mergedTags);
    }

    return payload;
  }

  buildFirewallRulePayload(firewallRule) {
    const fields = this.config.unifi.firewallRule;
    const payload = structuredClone(fields.extraPayload || {});
    const sourceGroupIds = Array.from(
      new Set(normalizeRemoteIds(firewallRule.sourceGroupIds)),
    );
    const destinationGroupIds = Array.from(
      new Set(normalizeRemoteIds(firewallRule.destinationGroupIds)),
    );

    if (fields.nameField) {
      setByPath(payload, fields.nameField, firewallRule.name || fields.managedName);
    }

    if (firewallRule.ruleset) {
      payload.ruleset = firewallRule.ruleset;
    }

    if (Number.isInteger(firewallRule.ruleIndex)) {
      payload.rule_index = firewallRule.ruleIndex;
    }

    if (fields.sourceGroupsField && sourceGroupIds.length > 0) {
      setByPath(payload, fields.sourceGroupsField, sourceGroupIds);
    }

    if (fields.destinationGroupsField && destinationGroupIds.length > 0) {
      setByPath(payload, fields.destinationGroupsField, destinationGroupIds);
    }

    if (fields.enabledField) {
      setByPath(payload, fields.enabledField, firewallRule.enabled !== false);
    }

    return payload;
  }

  buildFirewallPolicyPayload(firewallPolicy) {
    const fields = this.config.unifi.firewallPolicy;
    const payload = structuredClone(fields.extraPayload || {});

    if (fields.nameField) {
      setByPath(payload, fields.nameField, firewallPolicy.name || fields.managedName);
    }

    if (fields.enabledField) {
      setByPath(payload, fields.enabledField, firewallPolicy.enabled !== false);
    }

    if (firewallPolicy.action) {
      payload.action = String(firewallPolicy.action).trim().toUpperCase();
    }

    if (firewallPolicy.protocol) {
      payload.protocol = String(firewallPolicy.protocol).trim().toLowerCase();
    }

    if (firewallPolicy.ipVersion) {
      payload.ip_version = String(firewallPolicy.ipVersion).trim().toUpperCase();
    }

    if (
      firewallPolicy.schedule &&
      typeof firewallPolicy.schedule === "object" &&
      !Array.isArray(firewallPolicy.schedule)
    ) {
      payload.schedule = structuredClone(firewallPolicy.schedule);
    }

    if (Number.isInteger(firewallPolicy.index)) {
      payload.index = firewallPolicy.index;
    }

    payload.source =
      firewallPolicy.source &&
      typeof firewallPolicy.source === "object" &&
      !Array.isArray(firewallPolicy.source)
        ? structuredClone(firewallPolicy.source)
        : {};
    payload.destination =
      firewallPolicy.destination &&
      typeof firewallPolicy.destination === "object" &&
      !Array.isArray(firewallPolicy.destination)
        ? structuredClone(firewallPolicy.destination)
        : {};

    return payload;
  }

  buildManagedFirewallRules(groupIds) {
    const fields = this.config.unifi.firewallRule;
    const managedName = String(fields.managedName || "").trim();
    const normalizedGroups = normalizeManagedFirewallGroups(groupIds);
    const managedRules = [];

    normalizedGroups.forEach((group, index) => {
      managedRules.push({
        name: buildManagedFirewallRuleName(
          managedName,
          "incoming",
          group,
          index,
        ),
        enabled: true,
        ruleIndex: 20000 + index,
        ruleset: "WAN_IN",
        sourceGroupIds: [group.id],
        destinationGroupIds: [],
      });
      managedRules.push({
        name: buildManagedFirewallRuleName(
          managedName,
          "outgoing",
          group,
          index,
        ),
        enabled: true,
        ruleIndex: 40000 + index,
        ruleset: "WAN_OUT",
        sourceGroupIds: [],
        destinationGroupIds: [group.id],
      });
    });

    return managedRules;
  }

  buildManagedFirewallPolicies(groupIds, zones) {
    const fields = this.config.unifi.firewallPolicy;
    const managedName = String(fields.managedName || "").trim();
    const normalizedGroups = normalizeManagedFirewallGroups(groupIds);
    const normalizedZones = normalizeRemoteFirewallZones(zones);
    const externalZone =
      normalizedZones.find((zone) => zone.key === "external") || null;

    if (!externalZone) {
      return [];
    }

    const targetZones = normalizedZones.filter(
      (zone) => zone.id !== externalZone.id && zone.key !== "gateway",
    );
    const managedPolicies = [];

    targetZones.forEach((zone) => {
      normalizedGroups.forEach((group, index) => {
        managedPolicies.push({
          name: buildManagedFirewallPolicyName(
            managedName,
            "inbound",
            zone,
            group,
            index,
          ),
          action: "BLOCK",
          enabled: true,
          protocol: "all",
          ipVersion: "IPV4",
          source: {
            ip_group_id: group.id,
            ips: [],
            match_mac: false,
            match_opposite_ips: false,
            match_opposite_ports: false,
            matching_target: "IP",
            matching_target_type: "OBJECT",
            port_matching_type: "ANY",
            zone_id: externalZone.id,
          },
          destination: {
            match_opposite_ips: false,
            match_opposite_ports: false,
            matching_target: "ANY",
            port_matching_type: "ANY",
            zone_id: zone.id,
          },
        });
        managedPolicies.push({
          name: buildManagedFirewallPolicyName(
            managedName,
            "outbound",
            zone,
            group,
            index,
          ),
          action: "BLOCK",
          enabled: true,
          protocol: "all",
          ipVersion: "IPV4",
          source: {
            match_mac: false,
            match_opposite_ips: false,
            match_opposite_ports: false,
            matching_target: "ANY",
            port_matching_type: "ANY",
            zone_id: zone.id,
          },
          destination: {
            ip_group_id: group.id,
            ips: [],
            match_opposite_ips: false,
            match_opposite_ports: false,
            matching_target: "IP",
            matching_target_type: "OBJECT",
            port_matching_type: "ANY",
            zone_id: externalZone.id,
          },
        });
      });
    });

    return managedPolicies;
  }

  async listRemoteBlocklists(siteContext) {
    const path = this.buildBlocklistPath(
      this.config.unifi.blocklists.listPath,
      siteContext,
    );

    try {
      const response = await this.networkRequest(path);
      return unwrapList(response.data).map((item) => this.mapRemoteBlocklist(item));
    } catch (error) {
      throw wrapBlocklistEndpointError(
        error,
        path,
        "UNIFI_BLOCKLISTS_LIST_PATH",
      );
    }
  }

  async createRemoteBlocklist(siteContext, blocklist) {
    const path = this.buildBlocklistPath(
      this.config.unifi.blocklists.createPath,
      siteContext,
    );

    try {
      const response = await this.networkRequest(path, {
        method: this.config.unifi.blocklists.createMethod,
        body: this.buildRemotePayload(blocklist),
      });

      const remoteObject = pickRemoteObject(response.data, blocklist.name);
      return this.mapRemoteBlocklist(remoteObject || {});
    } catch (error) {
      throw wrapBlocklistEndpointError(
        error,
        path,
        "UNIFI_BLOCKLISTS_CREATE_PATH",
      );
    }
  }

  async updateRemoteBlocklist(siteContext, remoteId, blocklist) {
    const path = this.buildBlocklistPath(
      this.config.unifi.blocklists.updatePath,
      siteContext,
      remoteId,
    );

    try {
      const response = await this.networkRequest(path, {
        method: this.config.unifi.blocklists.updateMethod,
        body: this.buildRemotePayload(blocklist),
      });

      const remoteObject = pickRemoteObject(response.data, blocklist.name);
      return this.mapRemoteBlocklist(remoteObject || {});
    } catch (error) {
      throw wrapBlocklistEndpointError(
        error,
        path,
        "UNIFI_BLOCKLISTS_UPDATE_PATH",
      );
    }
  }

  async deleteRemoteBlocklist(siteContext, remoteId) {
    const path = this.buildBlocklistPath(
      this.config.unifi.blocklists.deletePath,
      siteContext,
      remoteId,
    );

    try {
      const response = await this.networkRequest(path, {
        method: this.config.unifi.blocklists.deleteMethod,
      });

      return unwrapObject(response.data);
    } catch (error) {
      throw wrapBlocklistEndpointError(
        error,
        path,
        "UNIFI_BLOCKLISTS_DELETE_PATH",
      );
    }
  }

  async listRemoteFirewallRules(siteContext) {
    const path = this.buildBlocklistPath(
      this.config.unifi.firewallRule.listPath,
      siteContext,
    );

    try {
      const response = await this.networkRequest(path);
      return unwrapList(response.data).map((item) => this.mapRemoteFirewallRule(item));
    } catch (error) {
      throw wrapFirewallRuleEndpointError(
        error,
        path,
        "UNIFI_FIREWALL_RULES_LIST_PATH",
      );
    }
  }

  async createRemoteFirewallRule(siteContext, firewallRule) {
    const path = this.buildBlocklistPath(
      this.config.unifi.firewallRule.createPath,
      siteContext,
    );

    try {
      const response = await this.networkRequest(path, {
        method: this.config.unifi.firewallRule.createMethod,
        body: this.buildFirewallRulePayload(firewallRule),
      });

      const remoteObject = pickRemoteObject(response.data, firewallRule.name);
      return this.mapRemoteFirewallRule(remoteObject || {});
    } catch (error) {
      throw wrapFirewallRuleEndpointError(
        error,
        path,
        "UNIFI_FIREWALL_RULES_CREATE_PATH",
      );
    }
  }

  async updateRemoteFirewallRule(siteContext, remoteId, firewallRule) {
    const path = this.buildBlocklistPath(
      this.config.unifi.firewallRule.updatePath,
      siteContext,
      remoteId,
    );

    try {
      const response = await this.networkRequest(path, {
        method: this.config.unifi.firewallRule.updateMethod,
        body: this.buildFirewallRulePayload(firewallRule),
      });

      const remoteObject = pickRemoteObject(response.data, firewallRule.name);
      return this.mapRemoteFirewallRule(remoteObject || {});
    } catch (error) {
      throw wrapFirewallRuleEndpointError(
        error,
        path,
        "UNIFI_FIREWALL_RULES_UPDATE_PATH",
      );
    }
  }

  async deleteRemoteFirewallRule(siteContext, remoteId) {
    const path = this.buildBlocklistPath(
      this.config.unifi.firewallRule.deletePath,
      siteContext,
      remoteId,
    );

    try {
      const response = await this.networkRequest(path, {
        method: this.config.unifi.firewallRule.deleteMethod,
      });

      return unwrapObject(response.data);
    } catch (error) {
      throw wrapFirewallRuleEndpointError(
        error,
        path,
        "UNIFI_FIREWALL_RULES_DELETE_PATH",
      );
    }
  }

  async listRemoteFirewallPolicies(siteContext) {
    const path = this.buildBlocklistPath(
      this.config.unifi.firewallPolicy.listPath,
      siteContext,
    );

    try {
      const response = await this.networkRequest(path);
      return unwrapList(response.data).map((item) => this.mapRemoteFirewallPolicy(item));
    } catch (error) {
      throw wrapFirewallPolicyEndpointError(
        error,
        path,
        "UNIFI_FIREWALL_POLICIES_LIST_PATH",
      );
    }
  }

  async listRemoteFirewallZoneMatrix(siteContext) {
    const path = this.buildBlocklistPath(
      this.config.unifi.firewallPolicy.zoneMatrixPath,
      siteContext,
    );

    try {
      const response = await this.networkRequest(path);
      return normalizeRemoteFirewallZones(unwrapList(response.data));
    } catch (error) {
      throw wrapFirewallPolicyEndpointError(
        error,
        path,
        "UNIFI_FIREWALL_POLICIES_ZONE_MATRIX_PATH",
      );
    }
  }

  async createRemoteFirewallPolicy(siteContext, firewallPolicy) {
    const path = this.buildBlocklistPath(
      this.config.unifi.firewallPolicy.createPath,
      siteContext,
    );

    try {
      const response = await this.networkRequest(path, {
        method: this.config.unifi.firewallPolicy.createMethod,
        body: this.buildFirewallPolicyPayload(firewallPolicy),
      });

      const remoteObject = unwrapObject(response.data) || response.data || {};
      return this.mapRemoteFirewallPolicy(remoteObject);
    } catch (error) {
      throw wrapFirewallPolicyEndpointError(
        error,
        path,
        "UNIFI_FIREWALL_POLICIES_CREATE_PATH",
      );
    }
  }

  async updateRemoteFirewallPolicy(siteContext, remoteId, firewallPolicy) {
    const path = this.buildBlocklistPath(
      this.config.unifi.firewallPolicy.updatePath,
      siteContext,
      remoteId,
    );

    try {
      const response = await this.networkRequest(path, {
        method: this.config.unifi.firewallPolicy.updateMethod,
        body: this.buildFirewallPolicyPayload(firewallPolicy),
      });

      const remoteObject = unwrapObject(response.data) || response.data || {};
      return this.mapRemoteFirewallPolicy(remoteObject);
    } catch (error) {
      throw wrapFirewallPolicyEndpointError(
        error,
        path,
        "UNIFI_FIREWALL_POLICIES_UPDATE_PATH",
      );
    }
  }

  async deleteRemoteFirewallPolicy(siteContext, remoteId) {
    const path = this.buildBlocklistPath(
      this.config.unifi.firewallPolicy.deletePath,
      siteContext,
      remoteId,
    );

    try {
      const response = await this.networkRequest(path, {
        method: this.config.unifi.firewallPolicy.deleteMethod,
      });

      return unwrapObject(response.data);
    } catch (error) {
      throw wrapFirewallPolicyEndpointError(
        error,
        path,
        "UNIFI_FIREWALL_POLICIES_DELETE_PATH",
      );
    }
  }

  async syncManagedLegacyFirewallRules(siteContext, sourceGroupIds) {
    const remoteRules = await this.listRemoteFirewallRules(siteContext);
    const managedRules = this.buildManagedFirewallRules(sourceGroupIds);
    const desiredKeys = new Set(
      managedRules.map((rule) => `${rule.ruleset}:${rule.name}`),
    );
    const managedNamePrefix = `${this.config.unifi.firewallRule.managedName} - `;
    const existingManagedRules = remoteRules.filter(
      (rule) =>
        rule.name.startsWith(managedNamePrefix) &&
        ["WAN_IN", "WAN_OUT"].includes(rule.ruleset),
    );
    const syncedRules = [];
    let createdCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;

    for (const managedRule of managedRules) {
      const existingRule =
        existingManagedRules.find(
          (rule) =>
            rule.name === managedRule.name && rule.ruleset === managedRule.ruleset,
        ) || null;

      try {
        if (existingRule?.id) {
          syncedRules.push(
            await this.updateRemoteFirewallRule(siteContext, existingRule.id, managedRule),
          );
          updatedCount += 1;
        } else {
          syncedRules.push(
            await this.createRemoteFirewallRule(siteContext, managedRule),
          );
          createdCount += 1;
        }
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 404 || !existingRule?.id) {
          throw error;
        }

        syncedRules.push(
          await this.createRemoteFirewallRule(siteContext, managedRule),
        );
        createdCount += 1;
      }
    }

    for (const existingRule of existingManagedRules) {
      const key = `${existingRule.ruleset}:${existingRule.name}`;
      if (desiredKeys.has(key) || !existingRule.id) {
        continue;
      }

      await this.deleteRemoteFirewallRule(siteContext, existingRule.id);
      deletedCount += 1;
    }

    return attachManagedFirewallSyncSummary(syncedRules, {
      mode: "legacy",
      createdCount,
      updatedCount,
      deletedCount,
      desiredCount: managedRules.length,
    });
  }

  async cleanupManagedLegacyFirewallRules(siteContext) {
    const remoteRules = await this.listRemoteFirewallRules(siteContext);
    const managedNamePrefix = `${this.config.unifi.firewallRule.managedName} - `;
    const existingManagedRules = remoteRules.filter(
      (rule) =>
        rule.name.startsWith(managedNamePrefix) &&
        ["WAN_IN", "WAN_OUT"].includes(rule.ruleset),
    );

    for (const existingRule of existingManagedRules) {
      if (!existingRule.id) {
        continue;
      }

      await this.deleteRemoteFirewallRule(siteContext, existingRule.id);
    }
  }

  async syncManagedFirewallPolicies(siteContext, sourceGroupIds) {
    const [zoneMatrix, remotePolicies] = await Promise.all([
      this.listRemoteFirewallZoneMatrix(siteContext),
      this.listRemoteFirewallPolicies(siteContext),
    ]);
    const managedPolicies = this.buildManagedFirewallPolicies(
      sourceGroupIds,
      zoneMatrix,
    );
    const desiredNames = new Set(managedPolicies.map((policy) => policy.name));
    const managedNamePrefix = `${this.config.unifi.firewallPolicy.managedName} - `;
    const existingManagedPolicies = remotePolicies.filter(
      (policy) =>
        policy.name.startsWith(managedNamePrefix) && policy.predefined !== true,
    );
    const syncedPolicies = [];
    let createdCount = 0;
    let updatedCount = 0;
    let deletedCount = 0;

    for (const managedPolicy of managedPolicies) {
      const existingPolicy =
        existingManagedPolicies.find((policy) => policy.name === managedPolicy.name) ||
        null;
      const policyToSync = existingPolicy?.index
        ? {
            ...managedPolicy,
            index: existingPolicy.index,
          }
        : managedPolicy;

      try {
        if (existingPolicy?.id) {
          syncedPolicies.push(
            await this.updateRemoteFirewallPolicy(
              siteContext,
              existingPolicy.id,
              policyToSync,
            ),
          );
          updatedCount += 1;
        } else {
          syncedPolicies.push(
            await this.createRemoteFirewallPolicy(siteContext, policyToSync),
          );
          createdCount += 1;
        }
      } catch (error) {
        if (
          !(error instanceof HttpError) ||
          error.status !== 404 ||
          !existingPolicy?.id
        ) {
          throw error;
        }

        syncedPolicies.push(
          await this.createRemoteFirewallPolicy(siteContext, managedPolicy),
        );
        createdCount += 1;
      }
    }

    for (const existingPolicy of existingManagedPolicies) {
      if (desiredNames.has(existingPolicy.name) || !existingPolicy.id) {
        continue;
      }

      await this.deleteRemoteFirewallPolicy(siteContext, existingPolicy.id);
      deletedCount += 1;
    }

    return attachManagedFirewallSyncSummary(syncedPolicies, {
      mode: "policy",
      createdCount,
      updatedCount,
      deletedCount,
      desiredCount: managedPolicies.length,
    });
  }

  async syncManagedFirewallRule(siteContext, sourceGroupIds) {
    try {
      const syncedPolicies = await this.syncManagedFirewallPolicies(
        siteContext,
        sourceGroupIds,
      );

      try {
        await this.cleanupManagedLegacyFirewallRules(siteContext);
      } catch (cleanupError) {
        if (!isUnsupportedFirewallPolicyEndpointError(cleanupError)) {
          throw cleanupError;
        }
      }

      return syncedPolicies;
    } catch (error) {
      if (!isUnsupportedFirewallPolicyEndpointError(error)) {
        throw error;
      }
    }

    return this.syncManagedLegacyFirewallRules(siteContext, sourceGroupIds);
  }

  async resolveSiteContext() {
    const sites = await this.listSites();

    if (this.config.unifi.siteId) {
      const configuredSiteId = String(this.config.unifi.siteId).trim();
      const matchedSite = sites.find(
        (site) =>
          site.id === configuredSiteId ||
          site.internalReference === configuredSiteId ||
          site.name === configuredSiteId,
      );

      if (matchedSite) {
        return {
          siteId: matchedSite.id,
          siteRef: matchedSite.internalReference || matchedSite.id,
          raw: matchedSite.raw,
        };
      }

      return {
        siteId: configuredSiteId,
        siteRef: configuredSiteId,
        raw: null,
      };
    }

    if (sites.length === 1) {
      return {
        siteId: sites[0].id,
        siteRef: sites[0].internalReference || sites[0].id,
        raw: sites[0].raw,
      };
    }

    if (sites.length === 0) {
      throw new HttpError(404, "No UniFi site was detected.");
    }

    throw new HttpError(
      400,
      "Multiple UniFi sites were detected. Configure UNIFI_SITE_ID to choose the target.",
    );
  }

  async resolveSiteId() {
    const site = await this.resolveSiteContext();
    return site.siteId;
  }
}
