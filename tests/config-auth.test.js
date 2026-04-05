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

test("requires auth username, password, and password seed together", () => {
  withEnv(
    {
      APP_AUTH_USERNAME: "admin",
      APP_AUTH_PASSWORD: "secret-pass",
      APP_AUTH_PASSWORD_SEED: "",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /APP_AUTH_USERNAME, APP_AUTH_PASSWORD, and APP_AUTH_PASSWORD_SEED must all be set/,
      );
    },
  );
});

test("enables auth when username, password, and seed are configured", () => {
  withEnv(
    {
      APP_AUTH_USERNAME: "admin",
      APP_AUTH_PASSWORD: "secret-pass",
      APP_AUTH_PASSWORD_SEED: "local-seed",
    },
    () => {
      const config = loadConfig();

      assert.equal(config.auth.enabled, true);
      assert.equal(config.auth.username, "admin");
      assert.equal(config.auth.password, "secret-pass");
      assert.equal(config.auth.passwordSeed, "local-seed");
      assert.deepEqual(config.auth.requiredVariables, [
        "APP_AUTH_USERNAME",
        "APP_AUTH_PASSWORD",
        "APP_AUTH_PASSWORD_SEED",
      ]);
      assert.deepEqual(config.auth.missingVariables, []);
      assert.equal(config.auth.inactiveReason, "");
    },
  );
});

test("accepts a seeded password hash in APP_AUTH_PASSWORD", () => {
  withEnv(
    {
      APP_AUTH_USERNAME: "admin",
      APP_AUTH_PASSWORD:
        "sha256:3680d6d032d97e52399f30f9ce152e13c8939349225fa2b01fbca39e3876d725",
      APP_AUTH_PASSWORD_SEED: "local-seed",
    },
    () => {
      const config = loadConfig();

      assert.equal(config.auth.enabled, true);
      assert.match(config.auth.password, /^sha256:/);
    },
  );
});

test("rejects an invalid seeded password hash format", () => {
  withEnv(
    {
      APP_AUTH_USERNAME: "admin",
      APP_AUTH_PASSWORD: "sha256:not-a-valid-hash",
      APP_AUTH_PASSWORD_SEED: "local-seed",
    },
    () => {
      assert.throws(
        () => loadConfig(),
        /APP_AUTH_PASSWORD must be a plain password or a sha256:<64-hex> seeded hash/,
      );
    },
  );
});

test("exposes missing auth variables when auth is disabled", () => {
  withEnv(
    {
      APP_AUTH_USERNAME: "",
      APP_AUTH_PASSWORD: "",
      APP_AUTH_PASSWORD_SEED: "",
    },
    () => {
      const config = loadConfig();

      assert.equal(config.auth.enabled, false);
      assert.deepEqual(config.auth.missingVariables, [
        "APP_AUTH_USERNAME",
        "APP_AUTH_PASSWORD",
        "APP_AUTH_PASSWORD_SEED",
      ]);
      assert.match(
        config.auth.inactiveReason,
        /required Docker environment variables are not configured/i,
      );
      assert.match(config.auth.activationHint, /restart the container/i);
    },
  );
});
