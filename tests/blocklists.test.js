import test from "node:test";
import assert from "node:assert/strict";

import { BlocklistService } from "../src/lib/blocklists.js";

function buildBlocklist(id, cidrs, overrides = {}) {
  return {
    id,
    name: `Blocklist ${id}`,
    description: "",
    enabled: true,
    cidrs,
    sourceUrl: "",
    refreshInterval: "",
    overflowMode: "split",
    refreshPaused: false,
    importedCidrs: [],
    remoteObjectId: "",
    remoteGroups: [],
    lastUrlSyncAt: "",
    lastUrlSyncStatus: "never",
    lastUrlSyncError: "",
    lastUnifiSyncAt: "",
    lastUnifiSyncStatus: "never",
    lastUnifiSyncError: "",
    lastSyncAt: "",
    lastSyncStatus: "never",
    lastSyncError: "",
    createdAt: "2026-04-04T00:00:00.000Z",
    updatedAt: "2026-04-04T00:00:00.000Z",
    ...overrides,
  };
}

function buildStore(blocklists) {
  let current = structuredClone(blocklists);

  return {
    async listBlocklists() {
      return structuredClone(current);
    },
    async saveBlocklists(next) {
      current = structuredClone(next);
      return structuredClone(current);
    },
    read() {
      return structuredClone(current);
    },
  };
}

function buildUnifiApi(maxEntries = 4000) {
  const remoteState = [];
  const calls = {
    create: [],
    update: [],
    delete: [],
  };

  return {
    calls,
    remoteState,
    config: {
      requestTimeoutMs: 15000,
      unifi: {
        blocklists: {
          maxEntries,
        },
      },
    },
    async resolveSiteContext() {
      return { siteId: "default", siteRef: "default" };
    },
    async listRemoteBlocklists() {
      return structuredClone(remoteState);
    },
    async createRemoteBlocklist(_siteContext, blocklist) {
      const created = {
        id: `remote-${remoteState.length + 1}`,
        name: blocklist.name,
        cidrs: structuredClone(blocklist.cidrs),
      };
      remoteState.push(created);
      calls.create.push({
        name: blocklist.name,
        cidrs: structuredClone(blocklist.cidrs),
      });
      return structuredClone(created);
    },
    async updateRemoteBlocklist(_siteContext, remoteId, blocklist) {
      const index = remoteState.findIndex((item) => item.id === remoteId);
      if (index < 0) {
        const error = new Error("Not found");
        error.status = 404;
        throw error;
      }

      remoteState[index] = {
        id: remoteId,
        name: blocklist.name,
        cidrs: structuredClone(blocklist.cidrs),
      };
      calls.update.push({
        id: remoteId,
        name: blocklist.name,
        cidrs: structuredClone(blocklist.cidrs),
      });
      return structuredClone(remoteState[index]);
    },
    async deleteRemoteBlocklist(_siteContext, remoteId) {
      const index = remoteState.findIndex((item) => item.id === remoteId);
      if (index >= 0) {
        remoteState.splice(index, 1);
      }
      calls.delete.push(remoteId);
      return { deleted: remoteId };
    },
  };
}

test("pushOne splits a large blocklist into suffixed UniFi groups", async () => {
  const store = buildStore([
    buildBlocklist("split-me", [
      "198.51.100.1/32",
      "198.51.100.2/32",
      "198.51.100.3/32",
      "198.51.100.4/32",
      "198.51.100.5/32",
    ]),
  ]);
  const unifiApi = buildUnifiApi(2);
  const service = new BlocklistService(store, unifiApi);

  const result = await service.pushOne("split-me");

  assert.deepEqual(
    unifiApi.calls.create.map((call) => call.name),
    ["Blocklist split-me_1", "Blocklist split-me_2", "Blocklist split-me_3"],
  );
  assert.deepEqual(
    unifiApi.calls.create.map((call) => call.cidrs.length),
    [2, 2, 1],
  );
  assert.deepEqual(result.blocklist.remoteGroups, [
    { id: "remote-1", name: "Blocklist split-me_1" },
    { id: "remote-2", name: "Blocklist split-me_2" },
    { id: "remote-3", name: "Blocklist split-me_3" },
  ]);
  assert.equal(result.blocklist.remoteObjectId, "remote-1");
});

test("pushOne truncates a large blocklist when requested", async () => {
  const store = buildStore([
    buildBlocklist(
      "truncate-me",
      [
        "203.0.113.1/32",
        "203.0.113.2/32",
        "203.0.113.3/32",
        "203.0.113.4/32",
      ],
      {
        overflowMode: "truncate",
      },
    ),
  ]);
  const unifiApi = buildUnifiApi(2);
  const service = new BlocklistService(store, unifiApi);

  const result = await service.pushOne("truncate-me");

  assert.equal(unifiApi.calls.create.length, 1);
  assert.deepEqual(unifiApi.calls.create[0], {
    name: "Blocklist truncate-me",
    cidrs: ["203.0.113.1/32", "203.0.113.2/32"],
  });
  assert.equal(result.plan.truncatedCount, 2);
  assert.deepEqual(result.blocklist.remoteGroups, [
    { id: "remote-1", name: "Blocklist truncate-me" },
  ]);
});

test("buildRemoteGroupPlan reads the live UniFi ipset max from runtime config", () => {
  const store = buildStore([]);
  const unifiApi = buildUnifiApi(4000);
  const service = new BlocklistService(store, unifiApi);

  unifiApi.config.unifi.blocklists.maxEntries = 2;

  const plan = service.buildRemoteGroupPlan(
    buildBlocklist("live-limit", [
      "198.51.100.1/32",
      "198.51.100.2/32",
      "198.51.100.3/32",
      "198.51.100.4/32",
      "198.51.100.5/32",
    ]),
  );

  assert.equal(plan.maxEntries, 2);
  assert.equal(plan.groups.length, 3);
  assert.deepEqual(
    plan.groups.map((group) => group.name),
    ["Blocklist live-limit_1", "Blocklist live-limit_2", "Blocklist live-limit_3"],
  );
});

test("removeManaged deletes every linked UniFi group for a blocklist", async () => {
  const store = buildStore([
    buildBlocklist("delete-me", ["192.0.2.1/32"], {
      remoteObjectId: "remote-1",
      remoteGroups: [
        { id: "remote-1", name: "Blocklist delete-me_1" },
        { id: "remote-2", name: "Blocklist delete-me_2" },
      ],
    }),
  ]);
  const unifiApi = buildUnifiApi(2);
  unifiApi.remoteState.push(
    { id: "remote-1", name: "Blocklist delete-me_1", cidrs: ["192.0.2.1/32"] },
    { id: "remote-2", name: "Blocklist delete-me_2", cidrs: ["192.0.2.2/32"] },
  );

  const service = new BlocklistService(store, unifiApi);
  await service.removeManaged("delete-me");

  assert.deepEqual(unifiApi.calls.delete, ["remote-1", "remote-2"]);
  assert.deepEqual(store.read(), []);
});
