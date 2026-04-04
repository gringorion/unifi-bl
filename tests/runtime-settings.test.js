import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";

import { RuntimeSettingsService } from "../src/lib/runtime-settings.js";

async function buildRuntimeSettingsService() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "unifi-bl-settings-"));
  const config = {
    allowInsecureTls: false,
    settingsFile: path.join(tempDir, "settings.json"),
    unifi: {
      networkBaseUrl: "",
      networkApiKey: "",
      siteId: "",
      siteManagerBaseUrl: "https://api.ui.com/v1",
      siteManagerApiKey: "",
      blocklists: {
        maxEntries: 4000,
      },
    },
  };

  const service = new RuntimeSettingsService(config);
  await service.load();

  return {
    config,
    filePath: config.settingsFile,
    service,
  };
}

test("runtime settings persist the selected UniFi ipset max", async () => {
  const { config, filePath, service } = await buildRuntimeSettingsService();

  const settings = await service.updateFromPayload({
    unifi: {
      blocklists: {
        maxEntries: 8000,
      },
    },
  });

  assert.equal(config.unifi.blocklists.maxEntries, 8000);
  assert.equal(settings.unifi.blocklists.maxEntries, 8000);

  const stored = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(stored.unifi.blocklists.maxEntries, 8000);
});

test("runtime settings reject unsupported UniFi ipset max values", async () => {
  const { service } = await buildRuntimeSettingsService();

  await assert.rejects(
    service.updateFromPayload({
      unifi: {
        blocklists: {
          maxEntries: 1234,
        },
      },
    }),
    /Invalid UniFi ipset max/,
  );
});
