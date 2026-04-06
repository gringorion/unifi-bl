import test from "node:test";
import assert from "node:assert/strict";

import { HttpError } from "../src/lib/http-client.js";
import { UnifiApi } from "../src/lib/unifi-api.js";

function buildApi() {
  const api = new UnifiApi({
    requestTimeoutMs: 15000,
    unifi: {
      networkBaseUrl: "https://gateway.example/proxy/network/integration/v1",
      networkApiKey: "test-key",
      blocklists: {},
      firewallRule: {
        listPath: "{networkRootUrl}/api/s/{siteRef}/rest/firewallrule",
        createPath: "{networkRootUrl}/api/s/{siteRef}/rest/firewallrule",
        updatePath: "{networkRootUrl}/api/s/{siteRef}/rest/firewallrule/{id}",
        deletePath: "{networkRootUrl}/api/s/{siteRef}/rest/firewallrule/{id}",
        createMethod: "POST",
        updateMethod: "PUT",
        deleteMethod: "DELETE",
        idField: "_id",
        nameField: "name",
        enabledField: "enabled",
        sourceGroupsField: "src_firewallgroup_ids",
        destinationGroupsField: "dst_firewallgroup_ids",
        managedName: "unifi-bl - block enabled lists",
        extraPayload: {
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
        },
      },
      firewallPolicy: {
        listPath: "{networkRootUrl}/v2/api/site/{siteRef}/firewall-policies",
        createPath: "{networkRootUrl}/v2/api/site/{siteRef}/firewall-policies",
        updatePath:
          "{networkRootUrl}/v2/api/site/{siteRef}/firewall-policies/{id}",
        deletePath:
          "{networkRootUrl}/v2/api/site/{siteRef}/firewall-policies/{id}",
        zoneMatrixPath:
          "{networkRootUrl}/v2/api/site/{siteRef}/firewall/zone-matrix",
        createMethod: "POST",
        updateMethod: "PUT",
        deleteMethod: "DELETE",
        idField: "_id",
        nameField: "name",
        enabledField: "enabled",
        managedName: "unifi-bl - block enabled lists",
        extraPayload: {
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
        },
      },
    },
  });

  const createdPolicies = [];
  const updatedPolicies = [];
  const deletedPolicies = [];
  const deletedLegacyRules = [];
  let remotePolicies = [];
  let remoteLegacyRules = [];
  let zoneMatrix = [
    {
      id: "zone-internal",
      name: "Internal",
      key: "internal",
    },
    {
      id: "zone-external",
      name: "External",
      key: "external",
    },
    {
      id: "zone-hotspot",
      name: "Hotspot",
      key: "hotspot",
    },
    {
      id: "zone-gateway",
      name: "Gateway",
      key: "gateway",
    },
  ];

  api.listRemoteFirewallZoneMatrix = async () => structuredClone(zoneMatrix);
  api.listRemoteFirewallPolicies = async () => structuredClone(remotePolicies);
  api.createRemoteFirewallPolicy = async (_siteContext, firewallPolicy) => {
    const createdPolicy = {
      id: `policy-${createdPolicies.length + 1}`,
      predefined: false,
      index: firewallPolicy.index ?? 10000 + createdPolicies.length,
      ...structuredClone(firewallPolicy),
    };
    createdPolicies.push(createdPolicy);
    remotePolicies.push(createdPolicy);
    return structuredClone(createdPolicy);
  };
  api.updateRemoteFirewallPolicy = async (_siteContext, remoteId, firewallPolicy) => {
    const updatedPolicy = {
      id: remoteId,
      predefined: false,
      index: firewallPolicy.index ?? 10000,
      ...structuredClone(firewallPolicy),
    };
    updatedPolicies.push(updatedPolicy);
    remotePolicies = remotePolicies.map((policy) =>
      policy.id === remoteId ? updatedPolicy : policy,
    );
    return structuredClone(updatedPolicy);
  };
  api.deleteRemoteFirewallPolicy = async (_siteContext, remoteId) => {
    deletedPolicies.push(remoteId);
    remotePolicies = remotePolicies.filter((policy) => policy.id !== remoteId);
    return { deleted: remoteId };
  };
  api.listRemoteFirewallRules = async () => structuredClone(remoteLegacyRules);
  api.deleteRemoteFirewallRule = async (_siteContext, remoteId) => {
    deletedLegacyRules.push(remoteId);
    remoteLegacyRules = remoteLegacyRules.filter((rule) => rule.id !== remoteId);
    return { deleted: remoteId };
  };

  return {
    api,
    createdPolicies,
    updatedPolicies,
    deletedPolicies,
    deletedLegacyRules,
    setRemotePolicies(nextPolicies) {
      remotePolicies = structuredClone(nextPolicies);
    },
    setRemoteLegacyRules(nextRules) {
      remoteLegacyRules = structuredClone(nextRules);
    },
    setZoneMatrix(nextZones) {
      zoneMatrix = structuredClone(nextZones);
    },
  };
}

test("syncManagedFirewallRule creates zone-based inbound and outbound policies and removes legacy managed rules", async () => {
  const { api, createdPolicies, deletedLegacyRules, setRemoteLegacyRules } = buildApi();
  setRemoteLegacyRules([
    {
      id: "fw-1",
      name: "unifi-bl - block enabled lists - incoming - BL_try_it",
      ruleset: "WAN_IN",
    },
    {
      id: "fw-2",
      name: "unifi-bl - block enabled lists - outgoing - BL_try_it",
      ruleset: "WAN_OUT",
    },
  ]);

  const policies = await api.syncManagedFirewallRule(
    { siteId: "default", siteRef: "default" },
    [{ id: "group-1", name: "BL_try_it" }],
  );

  assert.deepEqual(
    createdPolicies.map((policy) => ({
      name: policy.name,
      action: policy.action,
      sourceZoneId: policy.source.zone_id,
      sourceGroupId: policy.source.ip_group_id || "",
      destinationZoneId: policy.destination.zone_id,
      destinationGroupId: policy.destination.ip_group_id || "",
    })),
    [
      {
        name: "unifi-bl - block enabled lists - inbound - internal - BL_try_it",
        action: "BLOCK",
        sourceZoneId: "zone-external",
        sourceGroupId: "group-1",
        destinationZoneId: "zone-internal",
        destinationGroupId: "",
      },
      {
        name: "unifi-bl - block enabled lists - outbound - internal - BL_try_it",
        action: "BLOCK",
        sourceZoneId: "zone-internal",
        sourceGroupId: "",
        destinationZoneId: "zone-external",
        destinationGroupId: "group-1",
      },
      {
        name: "unifi-bl - block enabled lists - inbound - hotspot - BL_try_it",
        action: "BLOCK",
        sourceZoneId: "zone-external",
        sourceGroupId: "group-1",
        destinationZoneId: "zone-hotspot",
        destinationGroupId: "",
      },
      {
        name: "unifi-bl - block enabled lists - outbound - hotspot - BL_try_it",
        action: "BLOCK",
        sourceZoneId: "zone-hotspot",
        sourceGroupId: "",
        destinationZoneId: "zone-external",
        destinationGroupId: "group-1",
      },
    ],
  );
  assert.equal(policies.length, 4);
  assert.deepEqual(deletedLegacyRules, ["fw-1", "fw-2"]);
});

test("buildFirewallPolicyPayload includes the controller-required defaults and nested IP group targets", () => {
  const { api } = buildApi();

  const payload = api.buildFirewallPolicyPayload({
    name: "unifi-bl - block enabled lists - inbound - internal - BL_try_it",
    action: "BLOCK",
    enabled: true,
    protocol: "all",
    ipVersion: "IPV4",
    source: {
      ip_group_id: "group-1",
      ips: [],
      match_mac: false,
      match_opposite_ips: false,
      match_opposite_ports: false,
      matching_target: "IP",
      matching_target_type: "OBJECT",
      port_matching_type: "ANY",
      zone_id: "zone-external",
    },
    destination: {
      match_opposite_ips: false,
      match_opposite_ports: false,
      matching_target: "ANY",
      port_matching_type: "ANY",
      zone_id: "zone-internal",
    },
  });

  assert.deepEqual(payload, {
    action: "BLOCK",
    connection_state_type: "ALL",
    connection_states: [],
    create_allow_respond: false,
    description: "",
    destination: {
      match_opposite_ips: false,
      match_opposite_ports: false,
      matching_target: "ANY",
      port_matching_type: "ANY",
      zone_id: "zone-internal",
    },
    enabled: true,
    icmp_typename: "ANY",
    icmp_v6_typename: "ANY",
    ip_version: "IPV4",
    logging: false,
    match_ip_sec: false,
    match_opposite_protocol: false,
    name: "unifi-bl - block enabled lists - inbound - internal - BL_try_it",
    protocol: "all",
    schedule: {
      mode: "ALWAYS",
    },
    source: {
      ip_group_id: "group-1",
      ips: [],
      match_mac: false,
      match_opposite_ips: false,
      match_opposite_ports: false,
      matching_target: "IP",
      matching_target_type: "OBJECT",
      port_matching_type: "ANY",
      zone_id: "zone-external",
    },
  });
});

test("syncManagedFirewallRule deletes stale managed zone-based policies when no groups remain", async () => {
  const { api, deletedPolicies, deletedLegacyRules, setRemotePolicies, setRemoteLegacyRules } =
    buildApi();
  setRemotePolicies([
    {
      id: "policy-1",
      name: "unifi-bl - block enabled lists - inbound - internal - BL_try_it",
      predefined: false,
    },
    {
      id: "policy-2",
      name: "unifi-bl - block enabled lists - outbound - internal - BL_try_it",
      predefined: false,
    },
  ]);
  setRemoteLegacyRules([
    {
      id: "fw-legacy-1",
      name: "unifi-bl - block enabled lists - incoming - BL_try_it",
      ruleset: "WAN_IN",
    },
  ]);

  const policies = await api.syncManagedFirewallRule(
    { siteId: "default", siteRef: "default" },
    [],
  );

  assert.deepEqual(policies, []);
  assert.deepEqual(deletedPolicies, ["policy-1", "policy-2"]);
  assert.deepEqual(deletedLegacyRules, ["fw-legacy-1"]);
});

test("syncManagedFirewallRule falls back to legacy firewall rules when zone-based policies are unavailable", async () => {
  const { api } = buildApi();
  const legacyCalls = [];

  api.listRemoteFirewallZoneMatrix = async () => {
    throw new HttpError(404, "Not found");
  };
  api.syncManagedLegacyFirewallRules = async (_siteContext, groups) => {
    legacyCalls.push(structuredClone(groups));
    return [{ id: "legacy-rule-1" }];
  };

  const rules = await api.syncManagedFirewallRule(
    { siteId: "default", siteRef: "default" },
    [{ id: "group-1", name: "BL_try_it" }],
  );

  assert.deepEqual(legacyCalls, [[{ id: "group-1", name: "BL_try_it" }]]);
  assert.deepEqual(rules, [{ id: "legacy-rule-1" }]);
});
