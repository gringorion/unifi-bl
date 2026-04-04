import { randomBytes, timingSafeEqual, createHash } from "node:crypto";

import { HttpError } from "./http-client.js";

export const SESSION_DURATION_HOURS = 12;
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

function safeEqual(left, right, seed = "") {
  return timingSafeEqual(
    hashSecret(seedSecret(seed, left)),
    hashSecret(seedSecret(seed, right)),
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

  cleanupExpiredSessions(now = Date.now()) {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (!session || session.expiresAt <= now) {
        this.sessions.delete(sessionId);
      }
    }
  }

  getPublicSession(session = null) {
    if (!this.isEnabled()) {
      return {
        authEnabled: false,
        authenticated: true,
        username: "",
        expiresAt: null,
        sessionDurationHours: SESSION_DURATION_HOURS,
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

    const credentialsValid =
      Boolean(providedUsername) &&
      Boolean(providedPassword) &&
      safeEqual(providedUsername, expectedUsername) &&
      safeEqual(providedPassword, expectedPassword, passwordSeed);

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
