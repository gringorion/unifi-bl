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
    },
  );
});
