import test from "node:test";
import assert from "node:assert/strict";

import { SessionAuthService, SESSION_DURATION_HOURS } from "../src/lib/session-auth.js";

function createRequest(cookie = "") {
  return {
    headers: cookie ? { cookie } : {},
    socket: {},
  };
}

test("creates a 12 hour session cookie and clears it on logout", () => {
  const auth = new SessionAuthService({
    auth: {
      enabled: true,
      username: "admin",
      password: "secret-pass",
      passwordSeed: "local-seed",
    },
  });

  const loginResult = auth.login(
    {
      username: "admin",
      password: "secret-pass",
    },
    createRequest(),
  );

  assert.equal(loginResult.session.authEnabled, true);
  assert.equal(loginResult.session.authenticated, true);
  assert.equal(loginResult.session.username, "admin");
  assert.equal(loginResult.session.sessionDurationHours, SESSION_DURATION_HOURS);
  assert.deepEqual(loginResult.session.requiredVariables, []);
  assert.deepEqual(loginResult.session.missingVariables, []);
  assert.match(loginResult.setCookie, /HttpOnly/);
  assert.match(loginResult.setCookie, /SameSite=Lax/);
  assert.match(loginResult.setCookie, /Max-Age=43200/);

  const sessionCookie = loginResult.setCookie.split(";")[0];
  const authenticatedRequest = createRequest(sessionCookie);
  const storedSession = auth.getSessionFromRequest(authenticatedRequest);

  assert.ok(storedSession);
  assert.equal(storedSession.username, "admin");

  const logoutResult = auth.logout(authenticatedRequest);
  assert.equal(logoutResult.session.authenticated, false);
  assert.match(logoutResult.setCookie, /Max-Age=0/);
  assert.equal(auth.getSessionFromRequest(authenticatedRequest), null);
});

test("rejects invalid credentials", () => {
  const auth = new SessionAuthService({
    auth: {
      enabled: true,
      username: "admin",
      password: "secret-pass",
      passwordSeed: "local-seed",
    },
  });

  assert.throws(
    () =>
      auth.login(
        {
          username: "admin",
          password: "wrong-pass",
        },
        createRequest(),
      ),
    /Invalid username or password/,
  );
});

test("returns direct access when auth is disabled", () => {
  const auth = new SessionAuthService({
    auth: {
      enabled: false,
      username: "",
      password: "",
      passwordSeed: "",
      requiredVariables: [
        "APP_AUTH_USERNAME",
        "APP_AUTH_PASSWORD",
        "APP_AUTH_PASSWORD_SEED",
      ],
      missingVariables: [
        "APP_AUTH_USERNAME",
        "APP_AUTH_PASSWORD",
        "APP_AUTH_PASSWORD_SEED",
      ],
      inactiveReason:
        "Authentication is inactive because the required Docker environment variables are not configured.",
      activationHint:
        "Set APP_AUTH_USERNAME, APP_AUTH_PASSWORD, and APP_AUTH_PASSWORD_SEED in your Docker environment, then restart the container.",
    },
  });

  const session = auth.getPublicSession(null);

  assert.equal(session.authEnabled, false);
  assert.equal(session.authenticated, true);
  assert.equal(session.sessionDurationHours, SESSION_DURATION_HOURS);
  assert.deepEqual(session.requiredVariables, [
    "APP_AUTH_USERNAME",
    "APP_AUTH_PASSWORD",
    "APP_AUTH_PASSWORD_SEED",
  ]);
  assert.deepEqual(session.missingVariables, [
    "APP_AUTH_USERNAME",
    "APP_AUTH_PASSWORD",
    "APP_AUTH_PASSWORD_SEED",
  ]);
  assert.match(
    session.inactiveReason,
    /required Docker environment variables are not configured/i,
  );
});
