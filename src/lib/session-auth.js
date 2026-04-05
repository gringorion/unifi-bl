import { randomBytes, timingSafeEqual, createHash } from "node:crypto";

import { HttpError } from "./http-client.js";

export const SESSION_DURATION_HOURS = 12;
export const SEEDED_PASSWORD_HASH_PREFIX = "sha256:";
const SESSION_DURATION_MS = SESSION_DURATION_HOURS * 60 * 60 * 1000;
const DEFAULT_COOKIE_NAME = "unifi_bl_session";

function parseCookies(header = "") {
  return String(header)
    .split(";")
    .map((cookie) => cookie.trim())
    .filter(Boolean)
    .reduce((cookies, cookie) => {
      const separatorIndex = cookie.indexOf("=");
      if (separatorIndex <= 0) {
        return cookies;
      }

      const name = cookie.slice(0, separatorIndex).trim();
      const value = cookie.slice(separatorIndex + 1).trim();
      cookies[name] = decodeURIComponent(value);
      return cookies;
    }, {});
}

function hashSecret(value) {
  return createHash("sha256").update(String(value)).digest();
}

function seedSecret(seed, value) {
  return `${String(seed || "")}:${String(value || "")}`;
}

export function createSeededPasswordHash(password, seed = "") {
  return createHash("sha256").update(seedSecret(seed, password)).digest("hex");
}

function safeEqual(left, right, seed = "") {
  return timingSafeEqual(
    hashSecret(seedSecret(seed, left)),
    hashSecret(seedSecret(seed, right)),
  );
}

function isSeededHashSecret(value) {
  return String(value || "").startsWith(SEEDED_PASSWORD_HASH_PREFIX);
}

function resolveExpectedPasswordHash(password, seed = "") {
  const normalizedPassword = String(password || "").trim();
  if (!normalizedPassword) {
    return "";
  }

  if (isSeededHashSecret(normalizedPassword)) {
    return normalizedPassword
      .slice(SEEDED_PASSWORD_HASH_PREFIX.length)
      .trim()
      .toLowerCase();
  }

  // Backward compatibility for older deployments still storing plaintext.
  return createSeededPasswordHash(normalizedPassword, seed);
}

function safeHashEqual(leftHash, rightHash) {
  const normalizedLeft = String(leftHash || "").trim().toLowerCase();
  const normalizedRight = String(rightHash || "").trim().toLowerCase();

  if (!/^[0-9a-f]{64}$/.test(normalizedLeft) || !/^[0-9a-f]{64}$/.test(normalizedRight)) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(normalizedLeft, "hex"),
    Buffer.from(normalizedRight, "hex"),
  );
}

function isHttpsRequest(request) {
  return (
    Boolean(request.socket?.encrypted) ||
    String(request.headers["x-forwarded-proto"] || "")
      .split(",")[0]
      .trim()
      .toLowerCase() === "https"
  );
}

export class SessionAuthService {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
    this.cookieName = DEFAULT_COOKIE_NAME;
  }

  isEnabled() {
    return Boolean(this.config.auth?.enabled);
  }

  getPublicAuthStatus() {
    const requiredVariables = Array.isArray(this.config.auth?.requiredVariables)
      ? this.config.auth.requiredVariables
      : [];
    const missingVariables = Array.isArray(this.config.auth?.missingVariables)
      ? this.config.auth.missingVariables
      : [];

    return {
      requiredVariables,
      missingVariables,
      inactiveReason: String(this.config.auth?.inactiveReason || ""),
      activationHint: String(this.config.auth?.activationHint || ""),
    };
  }

  cleanupExpiredSessions(now = Date.now()) {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (!session || session.expiresAt <= now) {
        this.sessions.delete(sessionId);
      }
    }
  }

  getPublicSession(session = null) {
    const publicAuthStatus = this.getPublicAuthStatus();

    if (!this.isEnabled()) {
      return {
        authEnabled: false,
        authenticated: true,
        username: "",
        expiresAt: null,
        sessionDurationHours: SESSION_DURATION_HOURS,
        ...publicAuthStatus,
      };
    }

    return {
      authEnabled: true,
      authenticated: Boolean(session),
      username: session?.username || "",
      expiresAt: session?.expiresAt
        ? new Date(session.expiresAt).toISOString()
        : null,
      sessionDurationHours: SESSION_DURATION_HOURS,
      ...publicAuthStatus,
    };
  }

  createSession(username) {
    this.cleanupExpiredSessions();
    const sessionId = randomBytes(32).toString("hex");
    const expiresAt = Date.now() + SESSION_DURATION_MS;
    const session = {
      id: sessionId,
      username,
      expiresAt,
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  buildCookie(value, request, maxAgeSeconds) {
    const parts = [
      `${this.cookieName}=${encodeURIComponent(value)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${maxAgeSeconds}`,
    ];

    if (isHttpsRequest(request)) {
      parts.push("Secure");
    }

    return parts.join("; ");
  }

  getSessionFromRequest(request) {
    if (!this.isEnabled()) {
      return {
        id: "direct-access",
        username: "",
        expiresAt: null,
      };
    }

    this.cleanupExpiredSessions();
    const cookies = parseCookies(request.headers.cookie || "");
    const sessionId = cookies[this.cookieName];
    if (!sessionId) {
      return null;
    }

    const session = this.sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  requireSession(request) {
    const session = this.getSessionFromRequest(request);
    if (!session) {
      throw new HttpError(401, "Authentication required.");
    }

    return session;
  }

  login({ username, password }, request) {
    if (!this.isEnabled()) {
      return {
        session: this.getPublicSession({
          username: "",
          expiresAt: null,
        }),
        setCookie: "",
      };
    }

    const providedUsername = String(username || "").trim();
    const providedPassword = String(password || "");
    const expectedUsername = String(this.config.auth.username || "").trim();
    const expectedPassword = String(this.config.auth.password || "");
    const passwordSeed = String(this.config.auth.passwordSeed || "");
    const providedPasswordHash = createSeededPasswordHash(
      providedPassword,
      passwordSeed,
    );
    const expectedPasswordHash = resolveExpectedPasswordHash(
      expectedPassword,
      passwordSeed,
    );

    const credentialsValid =
      Boolean(providedUsername) &&
      Boolean(providedPassword) &&
      safeEqual(providedUsername, expectedUsername) &&
      safeHashEqual(providedPasswordHash, expectedPasswordHash);

    if (!credentialsValid) {
      throw new HttpError(401, "Invalid username or password.");
    }

    const session = this.createSession(expectedUsername);
    return {
      session: this.getPublicSession(session),
      setCookie: this.buildCookie(
        session.id,
        request,
        Math.floor(SESSION_DURATION_MS / 1000),
      ),
    };
  }

  logout(request) {
    if (this.isEnabled()) {
      const session = this.getSessionFromRequest(request);
      if (session?.id) {
        this.sessions.delete(session.id);
      }
    }

    return {
      session: this.getPublicSession(null),
      setCookie: this.buildCookie("", request, 0),
    };
  }
}
