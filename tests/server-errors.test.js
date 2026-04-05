import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const SERVER_START_TIMEOUT_MS = 10000;
const REQUEST_TIMEOUT_MS = 10000;

function createTempStorage() {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "unifi-bl-"));
  return {
    dataFile: path.join(tempDir, "blocklists.json"),
    settingsFile: path.join(tempDir, "settings.json"),
  };
}

async function waitForServerReady(baseUrl) {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) {
        return;
      }
      lastError = new Error(`Unexpected health status ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw lastError || new Error("Server did not start in time.");
}

test("rejects payloads larger than 1MB with 413", async () => {
  const port = 19080 + Math.floor(Math.random() * 1000);
  const baseUrl = `http://127.0.0.1:${port}`;
  const { dataFile, settingsFile } = createTempStorage();
  const child = spawn(process.execPath, ["src/server.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      DATA_FILE: dataFile,
      SETTINGS_FILE: settingsFile,
    },
    stdio: "ignore",
  });

  try {
    await waitForServerReady(baseUrl);

    const payload = {
      username: "test-user",
      password: "x".repeat(1024 * 1024 + 10),
    };
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    assert.equal(response.status, 413);
    const body = await response.json();
    assert.equal(body.error, "Request body too large.");
    assert.equal(body.details, undefined);
  } finally {
    child.kill();
  }
});
