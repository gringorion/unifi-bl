import test from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../src/lib/config.js";

function withEnv(overrides, callback) {
  const keys = Object.keys(overrides);
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  for (const [key, value] of Object.entries(overrides)) {
    process.env[key] = value;
  }

  try {
    callback();
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("loads managed firewall rule defaults", () => {
  withEnv(
    {
      UNIFI_FIREWALL_RULES_LIST_PATH: "",
      UNIFI_FIREWALL_RULES_CREATE_PATH: "",
      UNIFI_FIREWALL_RULES_UPDATE_PATH: "",
      UNIFI_FIREWALL_RULES_DELETE_PATH: "",
      UNIFI_FIREWALL_RULES_CREATE_METHOD: "",
      UNIFI_FIREWALL_RULES_UPDATE_METHOD: "",
      UNIFI_FIREWALL_RULES_DELETE_METHOD: "",
      UNIFI_FIREWALL_RULES_ID_FIELD: "",
      UNIFI_FIREWALL_RULES_NAME_FIELD: "",
      UNIFI_FIREWALL_RULES_ENABLED_FIELD: "",
      UNIFI_FIREWALL_RULES_SOURCE_GROUPS_FIELD: "",
      UNIFI_FIREWALL_RULES_DESTINATION_GROUPS_FIELD: "",
      UNIFI_FIREWALL_RULE_NAME: "",
      UNIFI_FIREWALL_RULES_EXTRA_PAYLOAD: "",
      UNIFI_FIREWALL_POLICIES_LIST_PATH: "",
      UNIFI_FIREWALL_POLICIES_CREATE_PATH: "",
      UNIFI_FIREWALL_POLICIES_UPDATE_PATH: "",
      UNIFI_FIREWALL_POLICIES_DELETE_PATH: "",
      UNIFI_FIREWALL_POLICIES_ZONE_MATRIX_PATH: "",
      UNIFI_FIREWALL_POLICIES_CREATE_METHOD: "",
      UNIFI_FIREWALL_POLICIES_UPDATE_METHOD: "",
      UNIFI_FIREWALL_POLICIES_DELETE_METHOD: "",
      UNIFI_FIREWALL_POLICIES_ID_FIELD: "",
      UNIFI_FIREWALL_POLICIES_NAME_FIELD: "",
      UNIFI_FIREWALL_POLICIES_ENABLED_FIELD: "",
      UNIFI_FIREWALL_POLICY_NAME: "",
      UNIFI_FIREWALL_POLICIES_EXTRA_PAYLOAD: "",
    },
    () => {
      const config = loadConfig();

      assert.equal(
        config.unifi.firewallRule.listPath,
        "{networkRootUrl}/api/s/{siteRef}/rest/firewallrule",
      );
      assert.equal(
        config.unifi.firewallRule.updatePath,
        "{networkRootUrl}/api/s/{siteRef}/rest/firewallrule/{id}",
      );
      assert.equal(config.unifi.firewallRule.sourceGroupsField, "src_firewallgroup_ids");
      assert.equal(
        config.unifi.firewallRule.destinationGroupsField,
        "dst_firewallgroup_ids",
      );
      assert.equal(
        config.unifi.firewallRule.managedName,
        "unifi-bl - block enabled lists",
      );
      assert.equal(
        config.unifi.firewallPolicy.listPath,
        "{networkRootUrl}/v2/api/site/{siteRef}/firewall-policies",
      );
      assert.equal(
        config.unifi.firewallPolicy.updatePath,
        "{networkRootUrl}/v2/api/site/{siteRef}/firewall-policies/{id}",
      );
      assert.equal(
        config.unifi.firewallPolicy.zoneMatrixPath,
        "{networkRootUrl}/v2/api/site/{siteRef}/firewall/zone-matrix",
      );
      assert.equal(
        config.unifi.firewallPolicy.managedName,
        "unifi-bl - block enabled lists",
      );
      assert.deepEqual(config.unifi.firewallRule.extraPayload, {
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
      });
      assert.deepEqual(config.unifi.firewallPolicy.extraPayload, {
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
      });
    },
  );
});
