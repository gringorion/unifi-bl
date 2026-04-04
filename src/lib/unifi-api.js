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

function pickRemoteBlocklistObject(payload, expectedName = "") {
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

      const remoteObject = pickRemoteBlocklistObject(response.data, blocklist.name);
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

      const remoteObject = pickRemoteBlocklistObject(response.data, blocklist.name);
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
