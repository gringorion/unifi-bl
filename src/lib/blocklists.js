import crypto from "node:crypto";

import { normalizeCidrs } from "./cidr.js";
import { HttpError, requestText } from "./http-client.js";

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

function findRemoteMatchByName(remoteObjects, blocklist) {
  const blocklistName = String(blocklist.name || "").trim();
  if (!blocklistName) {
    return null;
  }

  return (
    remoteObjects.find(
      (item) =>
        item.name === blocklistName && hasSameCidrs(item.cidrs, blocklist.cidrs),
    ) ||
    remoteObjects.find((item) => item.name === blocklistName) ||
    null
  );
}

function findRemoteMatch(remoteObjects, blocklist, { allowNameFallback = false } = {}) {
  if (blocklist.remoteObjectId) {
    const byId =
      remoteObjects.find((item) => item.id && item.id === blocklist.remoteObjectId) ||
      null;
    if (byId) {
      return byId;
    }
  }

  if (!allowNameFallback) {
    return null;
  }

  return findRemoteMatchByName(remoteObjects, blocklist);
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

function hasSameCidrs(left, right) {
  const normalizedLeft = normalizeCidrs(left);
  const normalizedRight = normalizeCidrs(right);

  if (normalizedLeft.length !== normalizedRight.length) {
    return false;
  }

  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
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

function findCreatedRemoteMatch(
  remoteObjects,
  blocklist,
  previousRemoteObjects = [],
) {
  const previousIds = new Set(
    previousRemoteObjects.map((item) => item.id).filter(Boolean),
  );
  const newCandidates = remoteObjects.filter(
    (item) => item.id && !previousIds.has(item.id),
  );

  return (
    newCandidates.find(
      (item) =>
        item.name === blocklist.name && hasSameCidrs(item.cidrs, blocklist.cidrs),
    ) ||
    newCandidates.find((item) => item.name === blocklist.name) ||
    remoteObjects.find(
      (item) =>
        item.name === blocklist.name && hasSameCidrs(item.cidrs, blocklist.cidrs),
    ) ||
    remoteObjects.find((item) => item.name === blocklist.name) ||
    null
  );
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
    refreshPaused:
      payload.refreshPaused === undefined
        ? Boolean(existing?.refreshPaused)
        : Boolean(payload.refreshPaused),
    importedCidrs: existing?.importedCidrs || [],
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

export class BlocklistService {
  constructor(store, unifiApi) {
    this.store = store;
    this.unifiApi = unifiApi;
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

  async create(payload) {
    const data = sanitizeBlocklistPayload(payload);
    const timestamp = now();
    const blocklist = {
      id: crypto.randomUUID(),
      ...data,
      remoteObjectId: "",
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    const blocklists = await this.list();
    blocklists.push(blocklist);
    await this.store.saveBlocklists(blocklists);
    return blocklist;
  }

  async createManaged(payload) {
    const blocklist = await this.create(payload);

    try {
      const result = await this.syncOne(blocklist.id);
      return result.blocklist;
    } catch (error) {
      await this.markSyncFailure(blocklist.id, error);
      throw error;
    }
  }

  async update(id, payload) {
    const { blocklist, blocklists } = await this.getOrThrow(id);
    const data = sanitizeBlocklistPayload(payload, blocklist);
    const updated = {
      ...blocklist,
      ...data,
      updatedAt: now(),
    };

    await this.store.saveBlocklists(
      blocklists.map((item) => (item.id === id ? updated : item)),
    );

    return updated;
  }

  async updateManaged(id, payload) {
    await this.update(id, payload);

    try {
      const result = await this.syncOne(id);
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

    return updated;
  }

  async remove(id) {
    const { blocklists } = await this.getOrThrow(id);
    await this.store.saveBlocklists(blocklists.filter((item) => item.id !== id));
  }

  async removeManaged(id) {
    const { blocklist } = await this.getOrThrow(id);
    let siteId = "";

    if (blocklist.remoteObjectId) {
      const siteContext = await this.unifiApi.resolveSiteContext();
      siteId = siteContext.siteId;
      const remoteObjects = await this.unifiApi.listRemoteBlocklists(siteContext);
      const remoteMatch = findRemoteMatch(remoteObjects, blocklist, {
        allowNameFallback: true,
      });
      const remoteIdToDelete = remoteMatch?.id || blocklist.remoteObjectId;

      try {
        await this.unifiApi.deleteRemoteBlocklist(
          siteContext,
          remoteIdToDelete,
        );
      } catch (error) {
        if (!isMissingRemoteBlocklistError(error)) {
          await this.markSyncFailure(id, error);
          throw error;
        }
      }
    }

    await this.remove(id);

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
      lastSyncAt: timestamp,
      lastSyncStatus: "remote-deleted",
      lastSyncError: "",
    };

    await this.store.saveBlocklists(
      blocklists.map((item) => (item.id === id ? updated : item)),
    );

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

  async resolveRemoteBlocklist(siteContext, blocklist, remoteObjects = null) {
    const candidates =
      remoteObjects || (await this.unifiApi.listRemoteBlocklists(siteContext));
    return findRemoteMatch(candidates, blocklist, { allowNameFallback: true });
  }

  async markUrlSyncNoChange(id, sourceResult, siteContext = null) {
    const { blocklist, blocklists, diff } = sourceResult;
    const context = siteContext || (await this.unifiApi.resolveSiteContext());
    const remoteObjects = await this.unifiApi.listRemoteBlocklists(context);
    const remoteMatch = findRemoteMatch(remoteObjects, blocklist, {
      allowNameFallback: true,
    });

    if (!remoteMatch) {
      return null;
    }

    const timestamp = now();
    const updated = {
      ...blocklist,
      remoteObjectId: remoteMatch.id || blocklist.remoteObjectId,
      lastUnifiSyncStatus: "ok",
      lastUnifiSyncError: "",
      lastSyncAt: timestamp,
      lastSyncStatus: "ok",
      lastSyncError: "",
    };

    await this.store.saveBlocklists(
      blocklists.map((item) => (item.id === updated.id ? updated : item)),
    );

    return {
      blocklist: updated,
      remote: remoteMatch,
      siteId: context.siteId,
      diff,
      skipped: true,
    };
  }

  async syncToUnifi(id, { refreshSource = false, sourceResult = null } = {}) {
    const siteContext = await this.unifiApi.resolveSiteContext();
    const resolvedSourceResult =
      sourceResult ||
      (refreshSource ? await this.importSourceIntoBlocklist(id) : await this.getOrThrow(id));
    const { blocklist, blocklists } = resolvedSourceResult.blocklist
      ? resolvedSourceResult
      : await this.getOrThrow(id);

    const preparedBlocklist = {
      ...blocklist,
      cidrs: mergeCidrs(blocklist),
    };

    const remoteObjects = await this.unifiApi.listRemoteBlocklists(siteContext);
    const remoteMatch = findRemoteMatch(remoteObjects, preparedBlocklist, {
      allowNameFallback: true,
    });
    const existingRemoteId = remoteMatch?.id || "";

    let remoteBlocklist = null;
    try {
      remoteBlocklist = existingRemoteId
        ? await this.unifiApi.updateRemoteBlocklist(
            siteContext,
            existingRemoteId,
            preparedBlocklist,
          )
        : await this.unifiApi.createRemoteBlocklist(
            siteContext,
            preparedBlocklist,
          );
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 404 || !existingRemoteId) {
        throw error;
      }

      remoteBlocklist = await this.unifiApi.createRemoteBlocklist(
        siteContext,
        preparedBlocklist,
      );
    }

    const resolvedRemote = remoteBlocklist.id
      ? remoteBlocklist
      : existingRemoteId
        ? await this.resolveRemoteBlocklist(siteContext, {
            ...preparedBlocklist,
            remoteObjectId: existingRemoteId,
          })
        : findCreatedRemoteMatch(
            await this.unifiApi.listRemoteBlocklists(siteContext),
            preparedBlocklist,
            remoteObjects,
          );
    const resolvedRemoteId = resolvedRemote?.id || existingRemoteId;

    if (!resolvedRemoteId) {
      throw new HttpError(
        502,
        "Sync reached UniFi, but the remote object ID could not be resolved. Check UNIFI_BLOCKLISTS_ID_FIELD.",
      );
    }

    const timestamp = now();
    const synced = {
      ...blocklist,
      remoteObjectId: resolvedRemoteId,
      lastUnifiSyncAt: timestamp,
      lastUnifiSyncStatus: "ok",
      lastUnifiSyncError: "",
      lastSyncAt: timestamp,
      lastSyncStatus: "ok",
      lastSyncError: "",
    };

    await this.store.saveBlocklists(
      blocklists.map((item) => (item.id === id ? synced : item)),
    );

    return {
      blocklist: synced,
      remote: resolvedRemote || remoteBlocklist,
      siteId: siteContext.siteId,
      diff: resolvedSourceResult.diff || null,
    };
  }

  async syncOne(id) {
    return this.syncToUnifi(id, { refreshSource: true });
  }

  async pushOne(id) {
    return this.syncToUnifi(id, { refreshSource: false });
  }

  async syncSource(id) {
    const { blocklist } = await this.getOrThrow(id);
    if (!blocklist.sourceUrl) {
      throw new HttpError(400, "This blocklist does not have a source URL.");
    }

    const siteContext = await this.unifiApi.resolveSiteContext();
    const sourceResult = await this.importSourceIntoBlocklist(id);
    if (sourceResult.diff?.unchanged && sourceResult.blocklist.remoteObjectId) {
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
  }

  async syncAll() {
    const blocklists = await this.list();
    const results = [];

    for (const blocklist of blocklists) {
      try {
        const synced = await this.syncOne(blocklist.id);
        results.push({
          id: blocklist.id,
          name: blocklist.name,
          status: "ok",
          remoteObjectId: synced.blocklist.remoteObjectId,
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

    return results;
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

  async deleteRemote(id) {
    return this.removeManaged(id);
  }
}
