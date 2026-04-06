import test from "node:test";
import assert from "node:assert/strict";

import { BlocklistService } from "../src/lib/blocklists.js";

function buildBlocklist(id, cidrs, overrides = {}) {
  return {
    id,
    name: `Blocklist ${id}`,
    description: "",
    enabled: true,
    includeInFirewall: true,
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
  const firewallRuleState = [];
  const calls = {
    create: [],
    update: [],
    delete: [],
    firewallSync: [],
  };
  const managedName = "unifi-bl - block enabled lists";

  function normalizeFirewallGroups(groups) {
    return Array.isArray(groups)
      ? groups
          .map((group) =>
            typeof group === "string"
              ? { id: group, name: group }
              : {
                  id: String(group?.id || "").trim(),
                  name: String(group?.name || group?.id || "").trim(),
                },
          )
          .filter((group) => group.id)
      : [];
  }

  function buildManagedFirewallRules(sourceGroups) {
    const normalizedGroups = normalizeFirewallGroups(sourceGroups);

    return normalizedGroups.flatMap((group, index) => [
      {
        id: firewallRuleState.find(
          (rule) => rule.ruleset === "WAN_IN" && rule.sourceGroupIds[0] === group.id,
        )?.id || `fw-in-${index + 1}`,
        name: `${managedName} - incoming - ${group.name}`,
        enabled: true,
        ruleset: "WAN_IN",
        sourceGroupIds: [group.id],
        destinationGroupIds: [],
      },
      {
        id: firewallRuleState.find(
          (rule) =>
            rule.ruleset === "WAN_OUT" && rule.destinationGroupIds[0] === group.id,
        )?.id || `fw-out-${index + 1}`,
        name: `${managedName} - outgoing - ${group.name}`,
        enabled: true,
        ruleset: "WAN_OUT",
        sourceGroupIds: [],
        destinationGroupIds: [group.id],
      },
    ]);
  }

  return {
    calls,
    remoteState,
    firewallRuleState,
    config: {
      requestTimeoutMs: 15000,
      unifi: {
        blocklists: {
          maxEntries,
        },
        firewallRule: {
          managedName,
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
    async syncManagedFirewallRule(_siteContext, sourceGroups) {
      const normalizedGroups = normalizeFirewallGroups(sourceGroups);
      calls.firewallSync.push(normalizedGroups.map((group) => group.id));

      if (normalizedGroups.length === 0 && firewallRuleState.length === 0) {
        return [];
      }

      const nextRules = buildManagedFirewallRules(normalizedGroups);

      if (firewallRuleState.length === 0) {
        firewallRuleState.push(...nextRules);
      } else {
        firewallRuleState.splice(0, firewallRuleState.length, ...nextRules);
      }

      return structuredClone(firewallRuleState);
    },
  };
}

test("pushOne splits a large blocklist into suffixed UniFi groups", async () => {
  const store = buildStore([
    buildBlocklist("split-me", [
      "8.8.8.1/32",
      "8.8.8.2/32",
      "8.8.8.3/32",
      "8.8.8.4/32",
      "8.8.8.5/32",
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
    [2, 2, 2],
  );
  assert.deepEqual(result.blocklist.remoteGroups, [
    { id: "remote-1", name: "Blocklist split-me_1" },
    { id: "remote-2", name: "Blocklist split-me_2" },
    { id: "remote-3", name: "Blocklist split-me_3" },
  ]);
  assert.equal(result.blocklist.remoteObjectId, "remote-1");
  assert.deepEqual(result.firewallRule?.sourceGroupIds, ["remote-1"]);
  assert.deepEqual(
    result.firewallRules?.map((rule) => [
      rule.ruleset,
      rule.sourceGroupIds[0] || rule.destinationGroupIds[0],
    ]),
    [
      ["WAN_IN", "remote-1"],
      ["WAN_OUT", "remote-1"],
      ["WAN_IN", "remote-2"],
      ["WAN_OUT", "remote-2"],
      ["WAN_IN", "remote-3"],
      ["WAN_OUT", "remote-3"],
    ],
  );
});

test("pushOne truncates a large blocklist when requested", async () => {
  const store = buildStore([
    buildBlocklist(
      "truncate-me",
      [
        "9.9.9.1/32",
        "9.9.9.2/32",
        "9.9.9.3/32",
        "9.9.9.4/32",
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
    cidrs: ["192.168.40.131/32", "9.9.9.1/32"],
  });
  assert.equal(result.plan.truncatedCount, 3);
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
      "11.0.0.1/32",
      "11.0.0.2/32",
      "11.0.0.3/32",
      "11.0.0.4/32",
      "11.0.0.5/32",
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
    buildBlocklist("delete-me", ["8.8.4.4/32"], {
      remoteObjectId: "remote-1",
      remoteGroups: [
        { id: "remote-1", name: "Blocklist delete-me_1" },
        { id: "remote-2", name: "Blocklist delete-me_2" },
      ],
    }),
  ]);
  const unifiApi = buildUnifiApi(2);
  unifiApi.remoteState.push(
    { id: "remote-1", name: "Blocklist delete-me_1", cidrs: ["8.8.4.4/32"] },
    { id: "remote-2", name: "Blocklist delete-me_2", cidrs: ["8.8.4.5/32"] },
  );

  const service = new BlocklistService(store, unifiApi);
  await service.removeManaged("delete-me");

  assert.deepEqual(unifiApi.calls.delete, ["remote-1", "remote-2"]);
  assert.deepEqual(store.read(), []);
});

test("pushOne excludes non-routable CIDRs before syncing groups and firewall sources", async () => {
  const store = buildStore([
    buildBlocklist("safe-only", [
      "8.8.8.8/32",
      "10.0.0.1/32",
      "192.168.1.0/24",
      "172.16.5.10/32",
    ]),
  ]);
  const unifiApi = buildUnifiApi(4000);
  const service = new BlocklistService(store, unifiApi);

  const result = await service.pushOne("safe-only");

  assert.deepEqual(unifiApi.calls.create, [
    {
      name: "Blocklist safe-only",
      cidrs: ["192.168.40.131/32", "8.8.8.8/32"],
    },
  ]);
  assert.deepEqual(result.blocklist.remoteGroups, [
    { id: "remote-1", name: "Blocklist safe-only" },
  ]);
  assert.deepEqual(result.firewallRule?.sourceGroupIds, ["remote-1"]);
});

test("pushOne keeps the managed firewall rules active for the forced controller IP", async () => {
  const store = buildStore([
    buildBlocklist("locals-only", ["192.168.1.10/32"], {
      remoteObjectId: "remote-1",
      remoteGroups: [{ id: "remote-1", name: "Blocklist locals-only" }],
    }),
  ]);
  const unifiApi = buildUnifiApi(4000);
  unifiApi.remoteState.push({
    id: "remote-1",
    name: "Blocklist locals-only",
    cidrs: ["192.168.1.10/32"],
  });
  unifiApi.firewallRuleState.push({
    id: "fw-1",
    name: "unifi-bl - block enabled lists - incoming - Blocklist locals-only",
    enabled: true,
    ruleset: "WAN_IN",
    sourceGroupIds: ["remote-1"],
    destinationGroupIds: [],
  });
  unifiApi.firewallRuleState.push({
    id: "fw-2",
    name: "unifi-bl - block enabled lists - outgoing - Blocklist locals-only",
    enabled: true,
    ruleset: "WAN_OUT",
    sourceGroupIds: [],
    destinationGroupIds: ["remote-1"],
  });
  const service = new BlocklistService(store, unifiApi);

  const result = await service.pushOne("locals-only");

  assert.deepEqual(unifiApi.calls.update, [
    {
      id: "remote-1",
      name: "Blocklist locals-only",
      cidrs: ["192.168.40.131/32"],
    },
  ]);
  assert.deepEqual(result.blocklist.remoteGroups, [
    { id: "remote-1", name: "Blocklist locals-only" },
  ]);
  assert.equal(result.firewallRule?.enabled, true);
  assert.deepEqual(result.firewallRules?.[1]?.destinationGroupIds, ["remote-1"]);
  assert.deepEqual(unifiApi.calls.firewallSync, [["remote-1"]]);
});

test("syncManagedFirewallRule excludes lists that are unchecked for the firewall policy", async () => {
  const store = buildStore([
    buildBlocklist("included", ["8.8.8.8/32"], {
      remoteObjectId: "remote-1",
      remoteGroups: [{ id: "remote-1", name: "Blocklist included" }],
    }),
    buildBlocklist("excluded", ["9.9.9.9/32"], {
      includeInFirewall: false,
      remoteObjectId: "remote-2",
      remoteGroups: [{ id: "remote-2", name: "Blocklist excluded" }],
    }),
  ]);
  const unifiApi = buildUnifiApi(4000);
  const service = new BlocklistService(store, unifiApi);

  const firewallRules = await service.syncManagedFirewallRule();

  assert.deepEqual(unifiApi.calls.firewallSync, [["remote-1"]]);
  assert.deepEqual(
    firewallRules.map((rule) => [rule.ruleset, rule.enabled]),
    [
      ["WAN_IN", true],
      ["WAN_OUT", true],
    ],
  );
});

test("syncManagedFirewallRule disables the managed firewall rules when every list is excluded", async () => {
  const store = buildStore([
    buildBlocklist("excluded", ["8.8.8.8/32"], {
      includeInFirewall: false,
      remoteObjectId: "remote-1",
      remoteGroups: [{ id: "remote-1", name: "Blocklist excluded" }],
    }),
  ]);
  const unifiApi = buildUnifiApi(4000);
  unifiApi.firewallRuleState.push(
    {
      id: "fw-1",
      name: "unifi-bl - block enabled lists - incoming - Blocklist excluded",
      enabled: true,
      ruleset: "WAN_IN",
      sourceGroupIds: ["remote-1"],
      destinationGroupIds: [],
    },
    {
      id: "fw-2",
      name: "unifi-bl - block enabled lists - outgoing - Blocklist excluded",
      enabled: true,
      ruleset: "WAN_OUT",
      sourceGroupIds: [],
      destinationGroupIds: ["remote-1"],
    },
  );
  const service = new BlocklistService(store, unifiApi);

  const firewallRules = await service.syncManagedFirewallRule();

  assert.deepEqual(unifiApi.calls.firewallSync, [[]]);
  assert.deepEqual(firewallRules, []);
  assert.deepEqual(unifiApi.firewallRuleState, []);
});

test("pushOne always includes 192.168.40.131 in the remote group payload", async () => {
  const store = buildStore([
    buildBlocklist("forced-ip", ["8.8.4.4/32"]),
  ]);
  const unifiApi = buildUnifiApi(4000);
  const service = new BlocklistService(store, unifiApi);

  await service.pushOne("forced-ip");

  assert.deepEqual(unifiApi.calls.create, [
    {
      name: "Blocklist forced-ip",
      cidrs: ["192.168.40.131/32", "8.8.4.4/32"],
    },
  ]);
});
