import crypto from "node:crypto";

import { filterRoutableCidrs, normalizeCidrs } from "./cidr.js";
import { HttpError, requestText } from "./http-client.js";
import {
  DEFAULT_UNIFI_IPSET_MAX_ENTRIES,
  toUnifiIpSetMaxEntries,
} from "./unifi-ipset.js";

export const REFRESH_INTERVAL_OPTIONS = [
  "4h",
  "6h",
  "12h",
  "1d",
  "2d",
  "4d",
  "7d",
  "14d",
];

const REFRESH_INTERVALS_MS = {
  "4h": 4 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "2d": 2 * 24 * 60 * 60 * 1000,
  "4d": 4 * 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "14d": 14 * 24 * 60 * 60 * 1000,
};

const IPV4_OR_CIDR_RE = /\b(?:\d{1,3}\.){3}\d{1,3}(?:\/\d{1,2})?\b/g;
const DEFAULT_OVERFLOW_MODE = "split";
const BLOCKLIST_OVERFLOW_MODES = new Set(["truncate", "split"]);
const ALWAYS_INCLUDED_REMOTE_CIDRS = ["192.168.40.131/32"];

function now() {
  return new Date().toISOString();
}

function normalizeSourceUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    if (!["http:", "https:"].includes(url.protocol)) {
      throw new Error("Unsupported protocol");
    }
    return url.toString();
  } catch {
    throw new HttpError(400, "Invalid source URL.");
  }
}

function normalizeRefreshInterval(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  if (!REFRESH_INTERVAL_OPTIONS.includes(trimmed)) {
    throw new HttpError(
      400,
      `Invalid refresh interval. Allowed values: ${REFRESH_INTERVAL_OPTIONS.join(", ")}`,
    );
  }

  return trimmed;
}

function normalizeOverflowMode(value, fallback = DEFAULT_OVERFLOW_MODE) {
  const normalized = String(value || "").trim().toLowerCase();
  return BLOCKLIST_OVERFLOW_MODES.has(normalized) ? normalized : fallback;
}

function normalizeRemoteGroups(remoteGroups, blocklistName = "", remoteObjectId = "") {
  const groups = Array.isArray(remoteGroups) ? remoteGroups : [];
  const normalized = groups
    .map((group) => {
      if (typeof group === "string") {
        return {
          id: group.trim(),
          name: "",
        };
      }

      if (!group || typeof group !== "object") {
        return null;
      }

      return {
        id: String(group.id || group.remoteObjectId || "").trim(),
        name: String(group.name || "").trim(),
      };
    })
    .filter((group) => group && (group.id || group.name));

  if (normalized.length > 0) {
    return normalized;
  }

  const legacyRemoteObjectId = String(remoteObjectId || "").trim();
  if (!legacyRemoteObjectId) {
    return [];
  }

  return [
    {
      id: legacyRemoteObjectId,
      name: String(blocklistName || "").trim(),
    },
  ];
}

function getStoredRemoteGroups(blocklist) {
  return normalizeRemoteGroups(
    blocklist?.remoteGroups,
    blocklist?.name,
    blocklist?.remoteObjectId,
  );
}

function getPrimaryRemoteObjectId(blocklist) {
  return getStoredRemoteGroups(blocklist)[0]?.id || "";
}

function hasRemoteLinks(blocklist) {
  return getStoredRemoteGroups(blocklist).length > 0;
}

function buildRemoteGroupName(baseName, index, totalGroups) {
  return totalGroups > 1 ? `${baseName}_${index + 1}` : baseName;
}

function extractCidrsFromSourceText(text) {
  const candidates = [];

  for (const rawLine of String(text || "").split(/\r?\n/)) {
    const sanitizedLine = rawLine.replace(/#.*/, " ").trim();
    if (!sanitizedLine) {
      continue;
    }

    const matches = sanitizedLine.match(IPV4_OR_CIDR_RE);
    if (matches) {
      candidates.push(...matches);
    }
  }

  return normalizeCidrs(candidates);
}

function mergeCidrs(blocklist) {
  return normalizeCidrs([
    ...(Array.isArray(blocklist.cidrs) ? blocklist.cidrs : []),
    ...(Array.isArray(blocklist.importedCidrs) ? blocklist.importedCidrs : []),
  ]);
}

function buildRemoteSyncCidrs(blocklist) {
  return normalizeCidrs([
    ...filterRoutableCidrs(mergeCidrs(blocklist)),
    ...ALWAYS_INCLUDED_REMOTE_CIDRS,
  ]);
}

function isIncludedInManagedFirewall(blocklist) {
  return blocklist?.enabled !== false && blocklist?.includeInFirewall !== false;
}

function collectManagedFirewallGroups(blocklists) {
  const seen = new Set();
  const groups = [];

  for (const blocklist of blocklists.filter((item) => isIncludedInManagedFirewall(item))) {
    for (const group of getStoredRemoteGroups(blocklist)) {
      const id = String(group.id || "").trim();
      if (!id || seen.has(id)) {
        continue;
      }

      seen.add(id);
      groups.push({
        id,
        name: String(group.name || "").trim(),
      });
    }
  }

  return groups;
}

function normalizeManagedFirewallRules(value) {
  if (Array.isArray(value)) {
    return value;
  }

  return value ? [value] : [];
}

function buildCidrsDiff(previousCidrs, nextCidrs) {
  const previous = normalizeCidrs(previousCidrs);
  const next = normalizeCidrs(nextCidrs);
  const previousSet = new Set(previous);
  const nextSet = new Set(next);

  let addedCount = 0;
  let removedCount = 0;

  for (const value of next) {
    if (!previousSet.has(value)) {
      addedCount += 1;
    }
  }

  for (const value of previous) {
    if (!nextSet.has(value)) {
      removedCount += 1;
    }
  }

  return {
    addedCount,
    removedCount,
    unchanged: addedCount === 0 && removedCount === 0,
  };
}

function findRemoteObjectById(remoteObjects, remoteId) {
  const normalizedId = String(remoteId || "").trim();
  if (!normalizedId) {
    return null;
  }

  return (
    remoteObjects.find((item) => String(item?.id || "").trim() === normalizedId) ||
    null
  );
}

function findRemoteObjectByName(remoteObjects, name) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) {
    return null;
  }

  return (
    remoteObjects.find((item) => String(item?.name || "").trim() === normalizedName) ||
    null
  );
}

function dedupeRemoteGroups(groups) {
  const seen = new Set();
  const unique = [];

  for (const group of groups) {
    if (!group || (!group.id && !group.name)) {
      continue;
    }

    const key = group.id ? `id:${group.id}` : `name:${group.name}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push(group);
  }

  return unique;
}

function buildRemoteGroupPlan(blocklist, maxEntries) {
  const safeMaxEntries =
    Number.isInteger(maxEntries) && maxEntries > 0
      ? maxEntries
      : DEFAULT_UNIFI_IPSET_MAX_ENTRIES;
  const cidrs = Array.isArray(blocklist.cidrs) ? blocklist.cidrs : [];
  const totalEntries = cidrs.length;
  const overflowMode = normalizeOverflowMode(blocklist.overflowMode);

  if (totalEntries === 0) {
    return {
      overflowMode,
      maxEntries: safeMaxEntries,
      totalEntries: 0,
      truncatedCount: 0,
      groups: [],
    };
  }

  if (totalEntries > safeMaxEntries && overflowMode === "split") {
    const totalGroups = Math.ceil(totalEntries / safeMaxEntries);
    const groups = [];

    for (let index = 0; index < totalGroups; index += 1) {
      const start = index * safeMaxEntries;
      groups.push({
        index,
        name: buildRemoteGroupName(blocklist.name, index, totalGroups),
        cidrs: cidrs.slice(start, start + safeMaxEntries),
      });
    }

    return {
      overflowMode,
      maxEntries: safeMaxEntries,
      totalEntries,
      truncatedCount: 0,
      groups,
    };
  }

  const truncatedCidrs =
    totalEntries > safeMaxEntries ? cidrs.slice(0, safeMaxEntries) : cidrs;

  return {
    overflowMode,
    maxEntries: safeMaxEntries,
    totalEntries,
    truncatedCount: Math.max(totalEntries - truncatedCidrs.length, 0),
    groups: [
      {
        index: 0,
        name: String(blocklist.name || "").trim(),
        cidrs: truncatedCidrs,
      },
    ],
  };
}

function resolveRemotePlanGroups(remoteObjects, blocklist, plan) {
  const storedGroups = getStoredRemoteGroups(blocklist);
  const plannedGroups = plan.groups.map((group, index) => {
    const stored = storedGroups[index] || null;
    let existing = null;

    if (stored?.id) {
      existing = findRemoteObjectById(remoteObjects, stored.id);
    }

    if (!existing && stored?.name) {
      existing = findRemoteObjectByName(remoteObjects, stored.name);
    }

    if (!existing) {
      existing = findRemoteObjectByName(remoteObjects, group.name);
    }

    return {
      ...group,
      existing,
      stored,
    };
  });

  const staleGroups = dedupeRemoteGroups(
    storedGroups
      .slice(plan.groups.length)
      .map(
        (group) =>
          findRemoteObjectById(remoteObjects, group.id) ||
          findRemoteObjectByName(remoteObjects, group.name) ||
          group,
      ),
  );

  return {
    plannedGroups,
    staleGroups,
  };
}

function isMissingRemoteBlocklistError(error) {
  if (error instanceof HttpError && error.status === 404) {
    return true;
  }

  const haystack = [
    error?.message,
    error?.details?.message,
    error?.details?.error,
    error?.details?.raw,
    error?.details?.meta?.msg,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return (
    haystack.includes("not found") ||
    haystack.includes("introuvable") ||
    haystack.includes("idinvalid") ||
    haystack.includes("id invalid") ||
    haystack.includes("invalid id") ||
    haystack.includes("no object") ||
    haystack.includes("unknown group")
  );
}

function sanitizeBlocklistPayload(payload, existing = null) {
  const name = String(payload.name || "").trim();
  if (!name) {
    throw new HttpError(400, "Blocklist name is required.");
  }

  return {
    name,
    description: String(payload.description || "").trim(),
    enabled: payload.enabled !== false,
    cidrs: normalizeCidrs(payload.cidrs),
    sourceUrl: normalizeSourceUrl(payload.sourceUrl),
    refreshInterval: normalizeRefreshInterval(payload.refreshInterval),
    overflowMode: normalizeOverflowMode(
      payload.overflowMode,
      existing?.overflowMode || DEFAULT_OVERFLOW_MODE,
    ),
    includeInFirewall:
      payload.includeInFirewall === undefined
        ? existing?.includeInFirewall !== false
        : Boolean(payload.includeInFirewall),
    refreshPaused:
      payload.refreshPaused === undefined
        ? Boolean(existing?.refreshPaused)
        : Boolean(payload.refreshPaused),
    importedCidrs: existing?.importedCidrs || [],
    remoteObjectId: getPrimaryRemoteObjectId(existing),
    remoteGroups: getStoredRemoteGroups(existing),
    lastUrlSyncAt: existing?.lastUrlSyncAt || "",
    lastUrlSyncStatus: existing?.lastUrlSyncStatus || "never",
    lastUrlSyncError: existing?.lastUrlSyncError || "",
    lastUrlAddedCount: existing?.lastUrlAddedCount || 0,
    lastUrlRemovedCount: existing?.lastUrlRemovedCount || 0,
    lastUnifiSyncAt: existing?.lastUnifiSyncAt || existing?.lastSyncAt || "",
    lastUnifiSyncStatus:
      existing?.lastUnifiSyncStatus || existing?.lastSyncStatus || "never",
    lastUnifiSyncError:
      existing?.lastUnifiSyncError || existing?.lastSyncError || "",
    lastSyncAt: existing?.lastSyncAt || "",
    lastSyncStatus: existing?.lastSyncStatus || "never",
    lastSyncError: existing?.lastSyncError || "",
  };
}

function shouldAutoRefresh(blocklist, nowMs = Date.now()) {
  if (
    !blocklist.enabled ||
    !blocklist.sourceUrl ||
    !blocklist.refreshInterval ||
    blocklist.refreshPaused
  ) {
    return false;
  }

  const intervalMs = REFRESH_INTERVALS_MS[blocklist.refreshInterval];
  if (!intervalMs) {
    return false;
  }

  if (!blocklist.lastUrlSyncAt) {
    return true;
  }

  const lastSyncMs = Date.parse(blocklist.lastUrlSyncAt);
  if (Number.isNaN(lastSyncMs)) {
    return true;
  }

  return nowMs - lastSyncMs >= intervalMs;
}

function normalizeTelemetryOrigin(value, fallback = "application") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || fallback;
}

function buildBlocklistTelemetryProperties(blocklist) {
  const mergedCidrs = mergeCidrs(blocklist || {});

  return {
    blocklist_id: String(blocklist?.id || "").trim(),
    enabled: blocklist?.enabled !== false,
    include_in_firewall: blocklist?.includeInFirewall !== false,
    has_source_url: Boolean(blocklist?.sourceUrl),
    refresh_interval: String(blocklist?.refreshInterval || "manual"),
    refresh_paused: Boolean(blocklist?.refreshPaused),
    overflow_mode: normalizeOverflowMode(blocklist?.overflowMode),
    cidr_count: Array.isArray(blocklist?.cidrs) ? blocklist.cidrs.length : 0,
    imported_cidr_count: Array.isArray(blocklist?.importedCidrs)
      ? blocklist.importedCidrs.length
      : 0,
    total_cidr_count: mergedCidrs.length,
    remote_group_count: getStoredRemoteGroups(blocklist).length,
  };
}

function buildSyncErrorTelemetryProperties(error) {
  return {
    error_class: String(error?.name || "Error"),
    is_http_error: error instanceof HttpError || Number.isInteger(error?.status),
    http_status: Number.isInteger(error?.status) ? error.status : 0,
  };
}

function buildFirewallTelemetryProperties(firewallRules) {
  const summary = firewallRules?.summary || {};

  return {
    firewall_mode: String(summary.mode || "").trim(),
    firewall_created_count: Number(summary.createdCount || 0),
    firewall_updated_count: Number(summary.updatedCount || 0),
    firewall_deleted_count: Number(summary.deletedCount || 0),
    firewall_active_count: Array.isArray(firewallRules) ? firewallRules.length : 0,
  };
}

export class BlocklistService {
  constructor(store, unifiApi, telemetry = null) {
    this.store = store;
    this.unifiApi = unifiApi;
    this.telemetry = telemetry;
  }

  async emitTelemetry(eventName, properties = {}) {
    const captureBackground = this.telemetry?.captureBackground;
    if (typeof captureBackground === "function") {
      try {
        captureBackground.call(this.telemetry, eventName, properties);
      } catch (error) {
        console.warn?.("[unifi_bl] telemetry dispatch failed", error);
      }
      return;
    }

    const capture = this.telemetry?.capture;
    if (typeof capture === "function") {
      try {
        await capture.call(this.telemetry, eventName, properties);
      } catch (error) {
        console.warn?.("[unifi_bl] telemetry dispatch failed", error);
      }
    }
  }

  async emitFirewallTelemetry(blocklist, firewallRules, extraProperties = {}) {
    const summary = firewallRules?.summary || {};
    const baseProperties = {
      ...buildBlocklistTelemetryProperties(blocklist),
      ...buildFirewallTelemetryProperties(firewallRules),
      ...extraProperties,
    };

    if (Number(summary.createdCount || 0) > 0) {
      await this.emitTelemetry("firewall_rule_created", baseProperties);
    }

    if (Number(summary.updatedCount || 0) > 0) {
      await this.emitTelemetry("firewall_rule_updated", baseProperties);
    }

    if (Number(summary.deletedCount || 0) > 0) {
      await this.emitTelemetry("firewall_rule_deleted", baseProperties);
    }
  }

  getMaxRemoteEntries() {
    return toUnifiIpSetMaxEntries(
      this.unifiApi?.config?.unifi?.blocklists?.maxEntries,
      DEFAULT_UNIFI_IPSET_MAX_ENTRIES,
    );
  }

  buildRemoteGroupPlan(blocklist) {
    return buildRemoteGroupPlan(blocklist, this.getMaxRemoteEntries());
  }

  async list() {
    return this.store.listBlocklists();
  }

  async listDueAutoRefresh() {
    const blocklists = await this.list();
    const nowMs = Date.now();
    return blocklists.filter((blocklist) => shouldAutoRefresh(blocklist, nowMs));
  }

  async getOrThrow(id) {
    const blocklists = await this.list();
    const blocklist = blocklists.find((item) => item.id === id);

    if (!blocklist) {
      throw new HttpError(404, "Blocklist not found.");
    }

    return { blocklist, blocklists };
  }

  async create(payload, options = {}) {
    const data = sanitizeBlocklistPayload(payload);
    const timestamp = now();
    const origin = normalizeTelemetryOrigin(options.origin, "application");
    const blocklist = {
      id: crypto.randomUUID(),
      ...data,
      remoteObjectId: "",
      remoteGroups: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const blocklists = await this.list();
    blocklists.push(blocklist);
    await this.store.saveBlocklists(blocklists);
    await this.emitTelemetry("blocklist_created", {
      ...buildBlocklistTelemetryProperties(blocklist),
      origin,
    });
    return blocklist;
  }

  async createManaged(payload, options = {}) {
    const blocklist = await this.create(payload, options);

    try {
      const result = await this.syncOne(blocklist.id, options);
      return result.blocklist;
    } catch (error) {
      await this.markSyncFailure(blocklist.id, error);
      throw error;
    }
  }

  async update(id, payload, options = {}) {
    const { blocklist, blocklists } = await this.getOrThrow(id);
    const data = sanitizeBlocklistPayload(payload, blocklist);
    const origin = normalizeTelemetryOrigin(options.origin, "application");
    const updated = {
      ...blocklist,
      ...data,
      updatedAt: now(),
    };

    await this.store.saveBlocklists(
      blocklists.map((item) => (item.id === id ? updated : item)),
    );
    await this.emitTelemetry("blocklist_updated", {
      ...buildBlocklistTelemetryProperties(updated),
      origin,
    });

    return updated;
  }

  async updateManaged(id, payload, options = {}) {
    await this.update(id, payload, options);

    try {
      const result = await this.syncOne(id, options);
      return result.blocklist;
    } catch (error) {
      await this.markSyncFailure(id, error);
      throw error;
    }
  }

  async setRefreshPaused(id, refreshPaused) {
    const { blocklist, blocklists } = await this.getOrThrow(id);
    const updated = {
      ...blocklist,
      refreshPaused: Boolean(refreshPaused),
      updatedAt: now(),
    };

    await this.store.saveBlocklists(
      blocklists.map((item) => (item.id === id ? updated : item)),
    );
    await this.emitTelemetry("blocklist_refresh_state_updated", {
      ...buildBlocklistTelemetryProperties(updated),
      refresh_paused: updated.refreshPaused,
    });

    return updated;
  }

  async remove(id) {
    const { blocklists } = await this.getOrThrow(id);
    await this.store.saveBlocklists(blocklists.filter((item) => item.id !== id));
  }

  async removeManaged(id, options = {}) {
    const { blocklist, blocklists } = await this.getOrThrow(id);
    const telemetryProperties = buildBlocklistTelemetryProperties(blocklist);
    const origin = normalizeTelemetryOrigin(options.origin, "application");
    let siteId = "";
    let siteContext = null;

    const storedRemoteGroups = getStoredRemoteGroups(blocklist);
    if (storedRemoteGroups.length > 0) {
      siteContext = await this.unifiApi.resolveSiteContext();
      siteId = siteContext.siteId;
      let remoteObjects = await this.unifiApi.listRemoteBlocklists(siteContext);

      for (const storedGroup of dedupeRemoteGroups(storedRemoteGroups)) {
        let remoteId = String(storedGroup.id || "").trim();
        if (!remoteId && storedGroup.name) {
          remoteId =
            findRemoteObjectByName(remoteObjects, storedGroup.name)?.id || "";
        }

        if (!remoteId) {
          continue;
        }

        try {
          await this.unifiApi.deleteRemoteBlocklist(siteContext, remoteId);
        } catch (error) {
          if (!isMissingRemoteBlocklistError(error)) {
            await this.markSyncFailure(id, error);
            throw error;
          }
        }

        remoteObjects = remoteObjects.filter((item) => item.id !== remoteId);
      }
    }

    const remainingBlocklists = blocklists.filter((item) => item.id !== id);
    await this.store.saveBlocklists(remainingBlocklists);

    if (siteContext) {
      const firewallRules = await this.syncManagedFirewallRule(
        siteContext,
        remainingBlocklists,
      );
      await this.emitFirewallTelemetry(blocklist, firewallRules, {
        origin,
        sync_mode: "delete",
      });
    }

    await this.emitTelemetry("blocklist_deleted", {
      ...telemetryProperties,
      origin,
    });

    return {
      ok: true,
      deletedId: id,
      siteId,
    };
  }

  async clearRemoteLink(id) {
    const { blocklist, blocklists } = await this.getOrThrow(id);
    const timestamp = now();
    const updated = {
      ...blocklist,
      remoteObjectId: "",
      remoteGroups: [],
      lastSyncAt: timestamp,
      lastSyncStatus: "remote-deleted",
      lastSyncError: "",
    };

    const savedBlocklists = blocklists.map((item) => (item.id === id ? updated : item));
    await this.store.saveBlocklists(savedBlocklists);

    if (this.unifiApi.isNetworkConfigured()) {
      const siteContext = await this.unifiApi.resolveSiteContext();
      const firewallRules = await this.syncManagedFirewallRule(siteContext, savedBlocklists);
      await this.emitFirewallTelemetry(updated, firewallRules, {
        origin: "application",
        sync_mode: "remote_link_cleared",
      });
    }

    return updated;
  }

  async fetchImportedCidrs(sourceUrl) {
    const response = await requestText({
      url: sourceUrl,
      timeoutMs: this.unifiApi.config.requestTimeoutMs,
      headers: {
        accept: "text/plain,text/*,*/*",
      },
    });

    return extractCidrsFromSourceText(response.text);
  }

  async importSourceIntoBlocklist(id) {
    const { blocklist, blocklists } = await this.getOrThrow(id);

    if (!blocklist.sourceUrl) {
      return { blocklist, blocklists, diff: null };
    }

    try {
      const importedCidrs = await this.fetchImportedCidrs(blocklist.sourceUrl);
      const diff = buildCidrsDiff(blocklist.importedCidrs, importedCidrs);
      const updated = {
        ...blocklist,
        importedCidrs,
        lastUrlSyncAt: now(),
        lastUrlSyncStatus: "ok",
        lastUrlSyncError: "",
        lastUrlAddedCount: diff.addedCount,
        lastUrlRemovedCount: diff.removedCount,
      };

      const saved = blocklists.map((item) => (item.id === id ? updated : item));
      await this.store.saveBlocklists(saved);
      return {
        blocklist: updated,
        blocklists: saved,
        diff,
      };
    } catch (error) {
      await this.markUrlSyncFailure(id, error);
      throw error;
    }
  }

  async syncPlannedRemoteGroups(siteContext, blocklist, remoteObjects, plan) {
    const { plannedGroups, staleGroups } = resolveRemotePlanGroups(
      remoteObjects,
      blocklist,
      plan,
    );
    const syncedRemoteGroups = [];

    for (const group of plannedGroups) {
      const remotePayload = {
        ...blocklist,
        name: group.name,
        cidrs: group.cidrs,
      };
      const existingRemoteId = group.existing?.id || group.stored?.id || "";

      let remoteBlocklist = null;
      try {
        remoteBlocklist = existingRemoteId
          ? await this.unifiApi.updateRemoteBlocklist(
              siteContext,
              existingRemoteId,
              remotePayload,
            )
          : await this.unifiApi.createRemoteBlocklist(siteContext, remotePayload);
      } catch (error) {
        if (!(error instanceof HttpError) || error.status !== 404 || !existingRemoteId) {
          throw error;
        }

        remoteBlocklist = await this.unifiApi.createRemoteBlocklist(
          siteContext,
          remotePayload,
        );
      }

      let resolvedRemote = remoteBlocklist?.id ? remoteBlocklist : null;
      if (!resolvedRemote) {
        const latestRemoteObjects = await this.unifiApi.listRemoteBlocklists(
          siteContext,
        );
        resolvedRemote =
          findRemoteObjectById(latestRemoteObjects, existingRemoteId) ||
          findRemoteObjectByName(latestRemoteObjects, group.name);
      }

      if (!resolvedRemote?.id) {
        throw new HttpError(
          502,
          `Sync reached UniFi, but the remote object ID could not be resolved for "${group.name}". Check UNIFI_BLOCKLISTS_ID_FIELD.`,
        );
      }

      syncedRemoteGroups.push({
        id: resolvedRemote.id,
        name: resolvedRemote.name || group.name,
      });
    }

    const syncedRemoteIds = new Set(
      syncedRemoteGroups.map((group) => group.id).filter(Boolean),
    );

    for (const staleGroup of staleGroups) {
      let remoteId = String(staleGroup.id || "").trim();
      if (!remoteId && staleGroup.name) {
        const latestRemoteObjects = await this.unifiApi.listRemoteBlocklists(
          siteContext,
        );
        remoteId =
          findRemoteObjectByName(latestRemoteObjects, staleGroup.name)?.id || "";
      }

      if (!remoteId || syncedRemoteIds.has(remoteId)) {
        continue;
      }

      try {
        await this.unifiApi.deleteRemoteBlocklist(siteContext, remoteId);
      } catch (error) {
        if (!isMissingRemoteBlocklistError(error)) {
          throw error;
        }
      }
    }

    return syncedRemoteGroups;
  }

  async markUrlSyncNoChange(id, sourceResult, siteContext = null) {
    const { blocklist, blocklists, diff } = sourceResult;
    const context = siteContext || (await this.unifiApi.resolveSiteContext());
    const remoteObjects = await this.unifiApi.listRemoteBlocklists(context);
    const preparedBlocklist = {
      ...blocklist,
      cidrs: buildRemoteSyncCidrs(blocklist),
    };
    const plan = this.buildRemoteGroupPlan(preparedBlocklist);
    const { plannedGroups, staleGroups } = resolveRemotePlanGroups(
      remoteObjects,
      preparedBlocklist,
      plan,
    );

    if (
      staleGroups.length > 0 ||
      plannedGroups.some((group) => !group.existing?.id)
    ) {
      return null;
    }

    const remoteGroups = plannedGroups.map((group) => ({
      id: group.existing.id,
      name: group.existing.name || group.name,
    }));
    const timestamp = now();
    const updated = {
      ...blocklist,
      remoteGroups,
      remoteObjectId: remoteGroups[0]?.id || "",
      lastUnifiSyncStatus: "ok",
      lastUnifiSyncError: "",
      lastSyncAt: timestamp,
      lastSyncStatus: "ok",
      lastSyncError: "",
    };

    const savedBlocklists = blocklists.map((item) =>
      item.id === updated.id ? updated : item,
    );
    await this.store.saveBlocklists(savedBlocklists);
    const firewallRules = normalizeManagedFirewallRules(
      await this.syncManagedFirewallRule(
        context,
        savedBlocklists,
      ),
    );

    return {
      blocklist: updated,
      remoteGroups,
      remote: remoteGroups[0] || null,
      firewallRule: firewallRules[0] || null,
      firewallRules,
      siteId: context.siteId,
      diff,
      skipped: true,
      plan: {
        groupCount: plan.groups.length,
        truncatedCount: plan.truncatedCount,
        totalEntries: plan.totalEntries,
        overflowMode: plan.overflowMode,
      },
    };
  }

  async syncToUnifi(id, { refreshSource = false, sourceResult = null } = {}) {
    const resolvedSourceResult =
      sourceResult ||
      (refreshSource ? await this.importSourceIntoBlocklist(id) : await this.getOrThrow(id));
    const { blocklist, blocklists } = resolvedSourceResult.blocklist
      ? resolvedSourceResult
      : await this.getOrThrow(id);

    const preparedBlocklist = {
      ...blocklist,
      overflowMode: normalizeOverflowMode(blocklist.overflowMode),
      cidrs: buildRemoteSyncCidrs(blocklist),
    };
    const plan = this.buildRemoteGroupPlan(preparedBlocklist);

    const siteContext = await this.unifiApi.resolveSiteContext();
    const remoteObjects = await this.unifiApi.listRemoteBlocklists(siteContext);
    const remoteGroups = await this.syncPlannedRemoteGroups(
      siteContext,
      preparedBlocklist,
      remoteObjects,
      plan,
    );

    const timestamp = now();
    const synced = {
      ...blocklist,
      overflowMode: preparedBlocklist.overflowMode,
      remoteGroups,
      remoteObjectId: remoteGroups[0]?.id || "",
      lastUnifiSyncAt: timestamp,
      lastUnifiSyncStatus: "ok",
      lastUnifiSyncError: "",
      lastSyncAt: timestamp,
      lastSyncStatus: "ok",
      lastSyncError: "",
    };

    const savedBlocklists = blocklists.map((item) => (item.id === id ? synced : item));
    await this.store.saveBlocklists(savedBlocklists);
    const firewallRules = normalizeManagedFirewallRules(
      await this.syncManagedFirewallRule(
        siteContext,
        savedBlocklists,
      ),
    );

    return {
      blocklist: synced,
      remoteGroups,
      remote: remoteGroups[0] || null,
      firewallRule: firewallRules[0] || null,
      firewallRules,
      siteId: siteContext.siteId,
      diff: resolvedSourceResult.diff || null,
      plan: {
        groupCount: plan.groups.length,
        truncatedCount: plan.truncatedCount,
        totalEntries: plan.totalEntries,
        overflowMode: plan.overflowMode,
      },
    };
  }

  async syncOne(id, options = {}) {
    return this.runSyncWithTelemetry(id, {
      origin: options.origin,
      syncMode: "source_refresh_and_unifi",
      action: () => this.syncToUnifi(id, { refreshSource: true }),
    });
  }

  async pushOne(id, options = {}) {
    return this.runSyncWithTelemetry(id, {
      origin: options.origin,
      syncMode: "unifi_only",
      action: () => this.syncToUnifi(id, { refreshSource: false }),
    });
  }

  async syncSource(id, options = {}) {
    const { blocklist } = await this.getOrThrow(id);
    if (!blocklist.sourceUrl) {
      throw new HttpError(400, "This blocklist does not have a source URL.");
    }

    const origin = normalizeTelemetryOrigin(options.origin, "application");
    await this.emitTelemetry("blocklist_source_sync_started", {
      ...buildBlocklistTelemetryProperties(blocklist),
      origin,
    });

    try {
      const result = await this.runSyncWithTelemetry(id, {
        origin,
        syncMode: "source_refresh_and_unifi",
        action: async () => {
          const siteContext = await this.unifiApi.resolveSiteContext();
          const sourceResult = await this.importSourceIntoBlocklist(id);
          if (sourceResult.diff?.unchanged && hasRemoteLinks(sourceResult.blocklist)) {
            const skipped = await this.markUrlSyncNoChange(
              id,
              sourceResult,
              siteContext,
            );
            if (skipped) {
              return skipped;
            }
          }

          return this.syncToUnifi(id, { sourceResult, refreshSource: false });
        },
      });

      await this.emitTelemetry("blocklist_source_sync_ok", {
        ...buildBlocklistTelemetryProperties(result.blocklist),
        origin,
        skipped: Boolean(result.skipped),
        added_count: Number(result.diff?.addedCount || 0),
        removed_count: Number(result.diff?.removedCount || 0),
      });

      return result;
    } catch (error) {
      await this.emitTelemetry("blocklist_source_sync_error", {
        ...buildBlocklistTelemetryProperties(blocklist),
        origin,
        ...buildSyncErrorTelemetryProperties(error),
      });
      throw error;
    }
  }

  async syncAll(options = {}) {
    const blocklists = await this.list();
    const results = [];
    const origin = normalizeTelemetryOrigin(options.origin, "application");

    await this.emitTelemetry("blocklist_sync_batch_started", {
      origin,
      blocklist_count: blocklists.length,
    });

    for (const blocklist of blocklists) {
      try {
        const synced = await this.syncOne(blocklist.id, { origin });
        results.push({
          id: blocklist.id,
          name: blocklist.name,
          status: "ok",
          remoteObjectId: synced.blocklist.remoteObjectId,
          remoteGroupsCount: synced.blocklist.remoteGroups?.length || 0,
          firewallCreatedCount: Number(synced.firewallRules?.summary?.createdCount || 0),
        });
      } catch (error) {
        results.push({
          id: blocklist.id,
          name: blocklist.name,
          status: "error",
          error: error.message,
        });

        await this.markSyncFailure(blocklist.id, error);
      }
    }

    await this.emitTelemetry("blocklist_sync_batch_completed", {
      origin,
      blocklist_count: blocklists.length,
      ok_count: results.filter((item) => item.status === "ok").length,
      error_count: results.filter((item) => item.status === "error").length,
    });

    return results;
  }

  async syncManagedFirewallRule(siteContext = null, blocklists = null) {
    const context = siteContext || (await this.unifiApi.resolveSiteContext());
    const currentBlocklists = blocklists || (await this.list());
    const sourceGroups = collectManagedFirewallGroups(currentBlocklists);

    return this.unifiApi.syncManagedFirewallRule(context, sourceGroups);
  }

  async runSyncWithTelemetry(id, { origin, syncMode, action }) {
    const normalizedOrigin = normalizeTelemetryOrigin(origin, "application");
    const { blocklist } = await this.getOrThrow(id);
    const startedProperties = {
      ...buildBlocklistTelemetryProperties(blocklist),
      origin: normalizedOrigin,
      sync_mode: syncMode,
    };

    await this.emitTelemetry("blocklist_sync_started", startedProperties);

    try {
      const result = await action();
      const syncedBlocklist = result?.blocklist || blocklist;
      const successProperties = {
        ...buildBlocklistTelemetryProperties(syncedBlocklist),
        origin: normalizedOrigin,
        sync_mode: syncMode,
        skipped: Boolean(result?.skipped),
        added_count: Number(result?.diff?.addedCount || 0),
        removed_count: Number(result?.diff?.removedCount || 0),
        planned_group_count: Number(result?.plan?.groupCount || 0),
        truncated_count: Number(result?.plan?.truncatedCount || 0),
        planned_total_entries: Number(result?.plan?.totalEntries || 0),
        ...buildFirewallTelemetryProperties(result?.firewallRules),
      };

      await this.emitTelemetry("blocklist_sync_ok", successProperties);
      await this.emitFirewallTelemetry(syncedBlocklist, result?.firewallRules, {
        origin: normalizedOrigin,
        sync_mode: syncMode,
      });

      return result;
    } catch (error) {
      await this.emitTelemetry("blocklist_sync_error", {
        ...startedProperties,
        ...buildSyncErrorTelemetryProperties(error),
      });
      throw error;
    }
  }

  async markUrlSyncFailure(id, error) {
    const { blocklist, blocklists } = await this.getOrThrow(id);
    const updated = {
      ...blocklist,
      lastUrlSyncAt: now(),
      lastUrlSyncStatus: "error",
      lastUrlSyncError: error.message,
    };

    await this.store.saveBlocklists(
      blocklists.map((item) => (item.id === id ? updated : item)),
    );

    return updated;
  }

  async markSyncFailure(id, error) {
    const { blocklist, blocklists } = await this.getOrThrow(id);
    const timestamp = now();
    const updated = {
      ...blocklist,
      lastSyncAt: timestamp,
      lastSyncStatus: "error",
      lastSyncError: error.message,
    };

    await this.store.saveBlocklists(
      blocklists.map((item) => (item.id === id ? updated : item)),
    );

    return updated;
  }

  async deleteRemote(id, options = {}) {
    return this.removeManaged(id, options);
  }
}
