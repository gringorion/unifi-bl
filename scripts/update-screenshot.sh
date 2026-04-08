#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_PATH="${1:-${SCREENSHOT_OUTPUT:-$ROOT_DIR/docs/screenshot.png}}"
MODE="${SCREENSHOT_MODE:-remote}"
CAPTURE_IMAGE="${SCREENSHOT_CAPTURE_IMAGE:-node:22-alpine}"
VIEWPORT_WIDTH="${SCREENSHOT_VIEWPORT_WIDTH:-1920}"
VIEWPORT_HEIGHT="${SCREENSHOT_VIEWPORT_HEIGHT:-1080}"
TIMEOUT_MS="${SCREENSHOT_TIMEOUT_MS:-30000}"
DEBUG_PORT="${SCREENSHOT_DEBUG_PORT:-$((9300 + RANDOM % 300))}"
TEMP_APP_PORT="${SCREENSHOT_TEMP_APP_PORT:-$((9600 + RANDOM % 300))}"
TEMP_APP_USERNAME="${SCREENSHOT_TEMP_APP_USERNAME:-gringorion}"
USE_REMOTE_TEMP_APP="${SCREENSHOT_REMOTE_USE_TEMP_APP:-true}"
EXPECTED_USER="${SCREENSHOT_EXPECTED_USER:-}"
FORBIDDEN_VISIBLE_TEXT="${SCREENSHOT_FORBIDDEN_VISIBLE_TEXT:-}"
REQUIRE_VERSION_FOOTER="${SCREENSHOT_REQUIRE_VERSION_FOOTER:-true}"

SSH_KEY="${SCREENSHOT_REMOTE_SSH_KEY:-${DEPLOY_131_SSH_KEY:-/config/workspace/.ssh/transcript_root_192_168_40_128}}"
KNOWN_HOSTS="${SCREENSHOT_REMOTE_KNOWN_HOSTS:-${DEPLOY_131_KNOWN_HOSTS:-/config/workspace/transcript/.ssh/known_hosts}}"
REMOTE_HOST="${SCREENSHOT_REMOTE_HOST:-${DEPLOY_131_HOST:-root@192.168.40.131}}"
REMOTE_DIR="${SCREENSHOT_REMOTE_DIR:-${DEPLOY_131_REMOTE_DIR:-/opt/unifi_bl}}"

read_remote_runtime_values() {
  ssh \
    -i "$SSH_KEY" \
    -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile="$KNOWN_HOSTS" \
    "$REMOTE_HOST" \
    "awk -F= '
      BEGIN {
        port = \"8080\";
        username = \"\";
        password = \"\";
        password_seed = \"\";
      }
      /^[[:space:]]*#/ || /^[[:space:]]*$/ {
        next;
      }
      {
        key = \$1;
        sub(/^[[:space:]]+/, \"\", key);
        sub(/[[:space:]]+$/, \"\", key);
        value = substr(\$0, index(\$0, \"=\") + 1);

        if (key == \"PORT\") {
          port = value;
        } else if (key == \"APP_AUTH_USERNAME\") {
          username = value;
        } else if (key == \"APP_AUTH_PASSWORD\") {
          password = value;
        } else if (key == \"APP_AUTH_PASSWORD_SEED\") {
          password_seed = value;
        }
      }
      END {
        print port;
        print username;
        print password;
        print password_seed;
      }
    ' '$REMOTE_DIR/.env' 2>/dev/null || printf '8080\n\n\n\n'"
}

run_local_capture() {
  mkdir -p "$(dirname "$OUTPUT_PATH")"

  docker run --rm -i --network host \
    -e SCREENSHOT_URL="$SCREENSHOT_URL" \
    -e SCREENSHOT_USERNAME="$SCREENSHOT_USERNAME" \
    -e SCREENSHOT_PASSWORD="$SCREENSHOT_PASSWORD" \
    -e SCREENSHOT_EXPECTED_USER="$EXPECTED_USER" \
    -e SCREENSHOT_FORBIDDEN_VISIBLE_TEXT="$FORBIDDEN_VISIBLE_TEXT" \
    -e SCREENSHOT_REQUIRE_VERSION_FOOTER="$REQUIRE_VERSION_FOOTER" \
    -e SCREENSHOT_VIEWPORT_WIDTH="$VIEWPORT_WIDTH" \
    -e SCREENSHOT_VIEWPORT_HEIGHT="$VIEWPORT_HEIGHT" \
    -e SCREENSHOT_TIMEOUT_MS="$TIMEOUT_MS" \
    -e SCREENSHOT_DEBUG_PORT="$DEBUG_PORT" \
    -e SCREENSHOT_CAPTURE_PATH="/tmp/unifi-bl-screenshot.png" \
    "$CAPTURE_IMAGE" \
    sh -lc 'apk add --no-cache chromium ttf-freefont font-noto nss >/dev/null && cat >/tmp/capture.mjs && node /tmp/capture.mjs && cat "$SCREENSHOT_CAPTURE_PATH"' \
    >"$OUTPUT_PATH" <<'NODE'
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import process from "node:process";

const screenshotUrl = String(process.env.SCREENSHOT_URL || "http://127.0.0.1:8080/").trim();
const screenshotUsername = String(process.env.SCREENSHOT_USERNAME || "");
const screenshotPassword = String(process.env.SCREENSHOT_PASSWORD || "");
const screenshotExpectedUser = String(process.env.SCREENSHOT_EXPECTED_USER || "").trim();
const screenshotControllerModel = String(process.env.SCREENSHOT_CONTROLLER_MODEL || "").trim();
const screenshotStatusNetwork = String(process.env.SCREENSHOT_STATUS_NETWORK || "").trim();
const screenshotStatusSite = String(process.env.SCREENSHOT_STATUS_SITE || "").trim();
const screenshotStatusDevices = String(process.env.SCREENSHOT_STATUS_DEVICES || "").trim();
const screenshotStatusClients = String(process.env.SCREENSHOT_STATUS_CLIENTS || "").trim();
const forbiddenVisibleText = String(process.env.SCREENSHOT_FORBIDDEN_VISIBLE_TEXT || "");
const requireVersionFooter = !["0", "false", "no"].includes(
  String(process.env.SCREENSHOT_REQUIRE_VERSION_FOOTER || "true").trim().toLowerCase(),
);
const viewportWidth = Number.parseInt(process.env.SCREENSHOT_VIEWPORT_WIDTH || "1920", 10);
const viewportHeight = Number.parseInt(process.env.SCREENSHOT_VIEWPORT_HEIGHT || "1080", 10);
const timeoutMs = Number.parseInt(process.env.SCREENSHOT_TIMEOUT_MS || "30000", 10);
const debugPort = Number.parseInt(process.env.SCREENSHOT_DEBUG_PORT || "9222", 10);
const capturePath = String(
  process.env.SCREENSHOT_CAPTURE_PATH || "/tmp/unifi-bl-screenshot.png",
).trim();

let chromeStderr = "";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(pathname) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}${pathname}`);
      if (response.ok) {
        return response.json();
      }
    } catch {}

    await sleep(250);
  }

  throw new Error(`Timed out while waiting for ${pathname}. ${chromeStderr}`.trim());
}

async function waitForCondition(fn, message) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await fn()) {
      return;
    }

    await sleep(250);
  }

  throw new Error(message);
}

const chromeProcess = spawn(
  "sh",
  [
    "-lc",
    [
      "CHROME_BIN=\"chromium\";",
      "if command -v chromium-browser >/dev/null 2>&1; then CHROME_BIN=\"chromium-browser\"; fi;",
      "exec \"$CHROME_BIN\"",
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      `--window-size=${viewportWidth},${viewportHeight}`,
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${debugPort}`,
      "--user-data-dir=/tmp/unifi-bl-chromium",
      "about:blank",
    ].join(" "),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);

chromeProcess.stderr.on("data", (chunk) => {
  chromeStderr += chunk.toString();
});

const targets = await waitForJson("/json/list");
const pageTarget = Array.isArray(targets)
  ? targets.find((target) => target?.type === "page" && target.webSocketDebuggerUrl)
  : null;

if (!pageTarget?.webSocketDebuggerUrl) {
  chromeProcess.kill("SIGKILL");
  throw new Error(`Unable to find a debuggable Chromium page. ${chromeStderr}`.trim());
}

const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
const pending = new Map();
const eventListeners = new Map();
let nextId = 0;

function registerEventListener(method, callback) {
  if (!eventListeners.has(method)) {
    eventListeners.set(method, new Set());
  }

  eventListeners.get(method).add(callback);
  return () => eventListeners.get(method)?.delete(callback);
}

function waitForEvent(method) {
  return new Promise((resolve) => {
    const cleanup = registerEventListener(method, (payload) => {
      cleanup();
      resolve(payload);
    });
  });
}

function send(method, params = {}) {
  const id = ++nextId;

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

socket.addEventListener("message", (event) => {
  const payload = JSON.parse(event.data);

  if (payload.id) {
    const handler = pending.get(payload.id);
    if (!handler) {
      return;
    }

    pending.delete(payload.id);

    if (payload.error) {
      handler.reject(new Error(payload.error.message || `CDP error in ${payload.error.code}`));
      return;
    }

    handler.resolve(payload.result || {});
    return;
  }

  if (!payload.method || !eventListeners.has(payload.method)) {
    return;
  }

  for (const callback of eventListeners.get(payload.method)) {
    callback(payload.params || {});
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
  }

  return result.result?.value;
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const loadEvent = waitForEvent("Page.loadEventFired");
  await send("Page.navigate", { url: screenshotUrl });
  await loadEvent;

  await sleep(1000);

  const loginVisible = await evaluate(`(() => {
    const field = document.querySelector("#login-username");
    if (!field) {
      return false;
    }

    const style = window.getComputedStyle(field);
    return !field.hidden && style.display !== "none" && style.visibility !== "hidden";
  })();`);

  if (loginVisible) {
    if (!screenshotUsername || !screenshotPassword) {
      throw new Error("Authentication is enabled for the screenshot target, but no plain username/password were provided.");
    }

    await evaluate(`(() => {
      const fill = (selector, value) => {
        const field = document.querySelector(selector);
        if (!field) {
          return false;
        }

        field.focus();
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      };

      return fill("#login-username", ${JSON.stringify(screenshotUsername)}) &&
        fill("#login-password", ${JSON.stringify(screenshotPassword)});
    })();`);

    await evaluate(`(() => {
      const button = document.querySelector("#login-submit-button");
      if (button) {
        button.click();
        return true;
      }

      const form = document.querySelector("#login-form");
      if (form) {
        form.requestSubmit();
        return true;
      }

      return false;
    })();`);
  }

  await waitForCondition(
    () =>
      evaluate(`(() => {
        const shell = document.querySelector("#app-shell");
        return Boolean(shell && !shell.hasAttribute("hidden"));
      })();`),
    "Timed out while waiting for the application shell.",
  );

  await sleep(1500);

  await evaluate(`(() => {
    const setText = (selector, value) => {
      const element = document.querySelector(selector);
      if (!element || !value) {
        return false;
      }

      element.textContent = value;
      return true;
    };

    const setStatus = (selector, value, tone = "ok") => {
      const element = document.querySelector(selector);
      if (!element || !value) {
        return false;
      }

      element.textContent = value;
      const tile = element.closest(".status-tile");
      if (tile) {
        tile.setAttribute("data-status-tone", tone);
      }
      return true;
    };

    setText("#controller-model", ${JSON.stringify(screenshotControllerModel)});
    setStatus("#quick-status-network", ${JSON.stringify(screenshotStatusNetwork)}, "ok");
    setStatus("#quick-status-site", ${JSON.stringify(screenshotStatusSite)}, "ok");
    setStatus("#quick-status-devices", ${JSON.stringify(screenshotStatusDevices)}, "ok");
    setStatus("#quick-status-clients", ${JSON.stringify(screenshotStatusClients)}, "ok");
    return true;
  })();`);

  await evaluate(`(() => {
    const siteValue = document.querySelector("#quick-status-site");
    if (!siteValue) {
      return false;
    }

    siteValue.textContent = String(siteValue.textContent || "").replace(/[A-Za-z0-9]/g, "X");
    return true;
  })();`);

  const audit = await evaluate(`(() => {
    const isVisible = (element) => {
      if (!element || element.hidden) {
        return false;
      }

      const style = window.getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0;
    };

    const versionFooter = document.querySelector("#app-version-footer");
    const navSessionValue = document.querySelector("#nav-session-value");
    const versionRect = versionFooter?.getBoundingClientRect?.() || null;

    return {
      visibleText: String(document.body.innerText || "")
        .replace(/\\s+/g, " ")
        .trim(),
      navSessionValue: navSessionValue ? String(navSessionValue.textContent || "").trim() : "",
      versionText: versionFooter ? String(versionFooter.textContent || "").trim() : "",
      versionVisible: isVisible(versionFooter),
      versionBottomLeft: Boolean(
        versionRect &&
          versionRect.left <= Math.max(160, window.innerWidth * 0.2) &&
          window.innerHeight - versionRect.bottom <=
            Math.max(80, window.innerHeight * 0.15),
      ),
    };
  })();`);

  if (screenshotExpectedUser && audit.navSessionValue !== screenshotExpectedUser) {
    throw new Error(
      `Expected the visible session user to be ${screenshotExpectedUser}, got ${audit.navSessionValue || "nothing"}.`,
    );
  }

  const forbiddenTerms = forbiddenVisibleText
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const loweredVisibleText = String(audit.visibleText || "").toLowerCase();
  const forbiddenHits = forbiddenTerms.filter((term) =>
    loweredVisibleText.includes(term.toLowerCase()),
  );

  if (forbiddenHits.length > 0) {
    throw new Error(
      `Forbidden visible text detected in the screenshot candidate: ${forbiddenHits.join(", ")}.`,
    );
  }

  if (
    requireVersionFooter &&
    (!audit.versionVisible ||
      !audit.versionBottomLeft ||
      !/^v\d+\.\d+\.\d+/.test(String(audit.versionText || "")))
  ) {
    throw new Error(
      `The application version footer is not clearly visible in the bottom-left corner. Current footer text: ${audit.versionText || "none"}.`,
    );
  }

  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  });

  await writeFile(capturePath, Buffer.from(screenshot.data, "base64"));
} finally {
  socket.close();
  chromeProcess.kill("SIGKILL");
  if (chromeProcess.exitCode === null) {
    await new Promise((resolve) => chromeProcess.once("exit", resolve));
  }
}
NODE
}

run_remote_capture() {
  local remote_port=""
  local remote_username=""
  local remote_password=""
  local remote_password_seed=""
  local remote_values=""
  local target_port=""
  local target_username=""
  local target_password=""

  if [[ -z "${SCREENSHOT_URL:-}" || -z "${SCREENSHOT_USERNAME:-}" || -z "${SCREENSHOT_PASSWORD:-}" ]]; then
    remote_values="$(read_remote_runtime_values)"
    remote_port="$(printf '%s\n' "$remote_values" | sed -n '1p')"
    remote_username="$(printf '%s\n' "$remote_values" | sed -n '2p')"
    remote_password="$(printf '%s\n' "$remote_values" | sed -n '3p')"
    remote_password_seed="$(printf '%s\n' "$remote_values" | sed -n '4p')"
  fi

  target_port="${remote_port:-8080}"
  target_username="${remote_username}"
  target_password="${remote_password}"

  if [[ "$USE_REMOTE_TEMP_APP" == "true" && -z "${SCREENSHOT_URL:-}" ]]; then
    target_port="$TEMP_APP_PORT"
    target_username="$TEMP_APP_USERNAME"
    target_password="${SCREENSHOT_PASSWORD:-$remote_password}"

    ssh \
      -i "$SSH_KEY" \
      -o IdentitiesOnly=yes \
      -o StrictHostKeyChecking=no \
      -o UserKnownHostsFile="$KNOWN_HOSTS" \
      "$REMOTE_HOST" \
      bash -s -- \
      "$REMOTE_DIR" \
      "$target_port" \
      "$target_username" \
      "$target_password" \
      "$remote_password_seed" <<'REMOTE_APP'
set -euo pipefail

REMOTE_DIR="$1"
TEMP_APP_PORT="$2"
TEMP_APP_USERNAME="$3"
TEMP_APP_PASSWORD="$4"
TEMP_APP_PASSWORD_SEED="$5"
TEMP_CONTAINER="unifi-bl-screenshot-app-${TEMP_APP_PORT}"

docker rm -f "$TEMP_CONTAINER" >/dev/null 2>&1 || true

docker run -d --rm \
  --name "$TEMP_CONTAINER" \
  --network host \
  -w /app \
  -v "$REMOTE_DIR:/app" \
  -e PORT="$TEMP_APP_PORT" \
  -e APP_AUTH_USERNAME="$TEMP_APP_USERNAME" \
  -e APP_AUTH_PASSWORD="$TEMP_APP_PASSWORD" \
  -e APP_AUTH_PASSWORD_SEED="$TEMP_APP_PASSWORD_SEED" \
  node:22-alpine \
  sh -lc 'node src/server.js' >/dev/null

for _ in $(seq 1 30); do
  if wget -qO- "http://127.0.0.1:${TEMP_APP_PORT}/api/session" >/dev/null 2>&1; then
    exit 0
  fi
  sleep 1
done

docker logs "$TEMP_CONTAINER" >&2 || true
docker rm -f "$TEMP_CONTAINER" >/dev/null 2>&1 || true
exit 1
REMOTE_APP
  fi

  SCREENSHOT_URL="${SCREENSHOT_URL:-http://127.0.0.1:${target_port}/}"
  SCREENSHOT_USERNAME="${SCREENSHOT_USERNAME:-$target_username}"
  SCREENSHOT_PASSWORD="${SCREENSHOT_PASSWORD:-$target_password}"

  if [[ "$SCREENSHOT_PASSWORD" == sha256:* ]]; then
    echo "Refusing to capture the screenshot with a hashed APP_AUTH_PASSWORD. Provide SCREENSHOT_PASSWORD with the plain password." >&2
    exit 1
  fi

  mkdir -p "$(dirname "$OUTPUT_PATH")"

  ssh \
    -i "$SSH_KEY" \
    -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=no \
    -o UserKnownHostsFile="$KNOWN_HOSTS" \
    "$REMOTE_HOST" \
    bash -s -- \
    "$CAPTURE_IMAGE" \
    "$USE_REMOTE_TEMP_APP" \
    "$TEMP_APP_PORT" \
    "$SCREENSHOT_URL" \
    "$SCREENSHOT_USERNAME" \
    "$SCREENSHOT_PASSWORD" \
    "$VIEWPORT_WIDTH" \
    "$VIEWPORT_HEIGHT" \
    "$TIMEOUT_MS" \
    "$DEBUG_PORT" \
    >"$OUTPUT_PATH" <<'REMOTE_SCRIPT'
set -euo pipefail

CAPTURE_IMAGE="$1"
USE_REMOTE_TEMP_APP="$2"
TEMP_APP_PORT="$3"
SCREENSHOT_URL="$4"
SCREENSHOT_USERNAME="$5"
SCREENSHOT_PASSWORD="$6"
SCREENSHOT_VIEWPORT_WIDTH="$7"
SCREENSHOT_VIEWPORT_HEIGHT="$8"
SCREENSHOT_TIMEOUT_MS="$9"
SCREENSHOT_DEBUG_PORT="${10}"
SCREENSHOT_CAPTURE_PATH="/tmp/unifi-bl-screenshot.png"
TEMP_CONTAINER="unifi-bl-screenshot-app-${TEMP_APP_PORT}"

cleanup() {
  if [[ "$USE_REMOTE_TEMP_APP" == "true" ]]; then
    docker rm -f "$TEMP_CONTAINER" >/dev/null 2>&1 || true
  fi
}

trap cleanup EXIT

docker run --rm -i --network host \
  -e SCREENSHOT_URL="$SCREENSHOT_URL" \
  -e SCREENSHOT_USERNAME="$SCREENSHOT_USERNAME" \
  -e SCREENSHOT_PASSWORD="$SCREENSHOT_PASSWORD" \
  -e SCREENSHOT_EXPECTED_USER="$EXPECTED_USER" \
  -e SCREENSHOT_FORBIDDEN_VISIBLE_TEXT="$FORBIDDEN_VISIBLE_TEXT" \
  -e SCREENSHOT_REQUIRE_VERSION_FOOTER="$REQUIRE_VERSION_FOOTER" \
  -e SCREENSHOT_VIEWPORT_WIDTH="$SCREENSHOT_VIEWPORT_WIDTH" \
  -e SCREENSHOT_VIEWPORT_HEIGHT="$SCREENSHOT_VIEWPORT_HEIGHT" \
  -e SCREENSHOT_TIMEOUT_MS="$SCREENSHOT_TIMEOUT_MS" \
  -e SCREENSHOT_DEBUG_PORT="$SCREENSHOT_DEBUG_PORT" \
  -e SCREENSHOT_CAPTURE_PATH="$SCREENSHOT_CAPTURE_PATH" \
  "$CAPTURE_IMAGE" \
  sh -lc 'apk add --no-cache chromium ttf-freefont font-noto nss >/dev/null && cat >/tmp/capture.mjs && node /tmp/capture.mjs && cat "$SCREENSHOT_CAPTURE_PATH"' <<'NODE'
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import process from "node:process";

const screenshotUrl = String(process.env.SCREENSHOT_URL || "http://127.0.0.1:8080/").trim();
const screenshotUsername = String(process.env.SCREENSHOT_USERNAME || "");
const screenshotPassword = String(process.env.SCREENSHOT_PASSWORD || "");
const screenshotExpectedUser = String(process.env.SCREENSHOT_EXPECTED_USER || "").trim();
const screenshotControllerModel = String(process.env.SCREENSHOT_CONTROLLER_MODEL || "").trim();
const screenshotStatusNetwork = String(process.env.SCREENSHOT_STATUS_NETWORK || "").trim();
const screenshotStatusSite = String(process.env.SCREENSHOT_STATUS_SITE || "").trim();
const screenshotStatusDevices = String(process.env.SCREENSHOT_STATUS_DEVICES || "").trim();
const screenshotStatusClients = String(process.env.SCREENSHOT_STATUS_CLIENTS || "").trim();
const forbiddenVisibleText = String(process.env.SCREENSHOT_FORBIDDEN_VISIBLE_TEXT || "");
const requireVersionFooter = !["0", "false", "no"].includes(
  String(process.env.SCREENSHOT_REQUIRE_VERSION_FOOTER || "true").trim().toLowerCase(),
);
const viewportWidth = Number.parseInt(process.env.SCREENSHOT_VIEWPORT_WIDTH || "1920", 10);
const viewportHeight = Number.parseInt(process.env.SCREENSHOT_VIEWPORT_HEIGHT || "1080", 10);
const timeoutMs = Number.parseInt(process.env.SCREENSHOT_TIMEOUT_MS || "30000", 10);
const debugPort = Number.parseInt(process.env.SCREENSHOT_DEBUG_PORT || "9222", 10);
const capturePath = String(
  process.env.SCREENSHOT_CAPTURE_PATH || "/tmp/unifi-bl-screenshot.png",
).trim();

let chromeStderr = "";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForJson(pathname) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}${pathname}`);
      if (response.ok) {
        return response.json();
      }
    } catch {}

    await sleep(250);
  }

  throw new Error(`Timed out while waiting for ${pathname}. ${chromeStderr}`.trim());
}

async function waitForCondition(fn, message) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await fn()) {
      return;
    }

    await sleep(250);
  }

  throw new Error(message);
}

const chromeProcess = spawn(
  "sh",
  [
    "-lc",
    [
      "CHROME_BIN=\"chromium\";",
      "if command -v chromium-browser >/dev/null 2>&1; then CHROME_BIN=\"chromium-browser\"; fi;",
      "exec \"$CHROME_BIN\"",
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      `--window-size=${viewportWidth},${viewportHeight}`,
      "--remote-debugging-address=127.0.0.1",
      `--remote-debugging-port=${debugPort}`,
      "--user-data-dir=/tmp/unifi-bl-chromium",
      "about:blank",
    ].join(" "),
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);

chromeProcess.stderr.on("data", (chunk) => {
  chromeStderr += chunk.toString();
});

const targets = await waitForJson("/json/list");
const pageTarget = Array.isArray(targets)
  ? targets.find((target) => target?.type === "page" && target.webSocketDebuggerUrl)
  : null;

if (!pageTarget?.webSocketDebuggerUrl) {
  chromeProcess.kill("SIGKILL");
  throw new Error(`Unable to find a debuggable Chromium page. ${chromeStderr}`.trim());
}

const socket = new WebSocket(pageTarget.webSocketDebuggerUrl);
const pending = new Map();
const eventListeners = new Map();
let nextId = 0;

function registerEventListener(method, callback) {
  if (!eventListeners.has(method)) {
    eventListeners.set(method, new Set());
  }

  eventListeners.get(method).add(callback);
  return () => eventListeners.get(method)?.delete(callback);
}

function waitForEvent(method) {
  return new Promise((resolve) => {
    const cleanup = registerEventListener(method, (payload) => {
      cleanup();
      resolve(payload);
    });
  });
}

function send(method, params = {}) {
  const id = ++nextId;

  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

socket.addEventListener("message", (event) => {
  const payload = JSON.parse(event.data);

  if (payload.id) {
    const handler = pending.get(payload.id);
    if (!handler) {
      return;
    }

    pending.delete(payload.id);

    if (payload.error) {
      handler.reject(new Error(payload.error.message || `CDP error in ${payload.error.code}`));
      return;
    }

    handler.resolve(payload.result || {});
    return;
  }

  if (!payload.method || !eventListeners.has(payload.method)) {
    return;
  }

  for (const callback of eventListeners.get(payload.method)) {
    callback(payload.params || {});
  }
});

await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", reject, { once: true });
});

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
  }

  return result.result?.value;
}

try {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: viewportWidth,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: false,
  });

  const loadEvent = waitForEvent("Page.loadEventFired");
  await send("Page.navigate", { url: screenshotUrl });
  await loadEvent;

  await sleep(1000);

  const loginVisible = await evaluate(`(() => {
    const field = document.querySelector("#login-username");
    if (!field) {
      return false;
    }

    const style = window.getComputedStyle(field);
    return !field.hidden && style.display !== "none" && style.visibility !== "hidden";
  })();`);

  if (loginVisible) {
    if (!screenshotUsername || !screenshotPassword) {
      throw new Error("Authentication is enabled for the screenshot target, but no plain username/password were provided.");
    }

    await evaluate(`(() => {
      const fill = (selector, value) => {
        const field = document.querySelector(selector);
        if (!field) {
          return false;
        }

        field.focus();
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      };

      return fill("#login-username", ${JSON.stringify(screenshotUsername)}) &&
        fill("#login-password", ${JSON.stringify(screenshotPassword)});
    })();`);

    await evaluate(`(() => {
      const button = document.querySelector("#login-submit-button");
      if (button) {
        button.click();
        return true;
      }

      const form = document.querySelector("#login-form");
      if (form) {
        form.requestSubmit();
        return true;
      }

      return false;
    })();`);
  }

  await waitForCondition(
    () =>
      evaluate(`(() => {
        const shell = document.querySelector("#app-shell");
        return Boolean(shell && !shell.hasAttribute("hidden"));
      })();`),
    "Timed out while waiting for the application shell.",
  );

  await sleep(1500);

  await evaluate(`(() => {
    const setText = (selector, value) => {
      const element = document.querySelector(selector);
      if (!element || !value) {
        return false;
      }

      element.textContent = value;
      return true;
    };

    const setStatus = (selector, value, tone = "ok") => {
      const element = document.querySelector(selector);
      if (!element || !value) {
        return false;
      }

      element.textContent = value;
      const tile = element.closest(".status-tile");
      if (tile) {
        tile.setAttribute("data-status-tone", tone);
      }
      return true;
    };

    setText("#controller-model", ${JSON.stringify(screenshotControllerModel)});
    setStatus("#quick-status-network", ${JSON.stringify(screenshotStatusNetwork)}, "ok");
    setStatus("#quick-status-site", ${JSON.stringify(screenshotStatusSite)}, "ok");
    setStatus("#quick-status-devices", ${JSON.stringify(screenshotStatusDevices)}, "ok");
    setStatus("#quick-status-clients", ${JSON.stringify(screenshotStatusClients)}, "ok");
    return true;
  })();`);

  await evaluate(`(() => {
    const siteValue = document.querySelector("#quick-status-site");
    if (!siteValue) {
      return false;
    }

    siteValue.textContent = String(siteValue.textContent || "").replace(/[A-Za-z0-9]/g, "X");
    return true;
  })();`);

  const audit = await evaluate(`(() => {
    const isVisible = (element) => {
      if (!element || element.hidden) {
        return false;
      }

      const style = window.getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0;
    };

    const versionFooter = document.querySelector("#app-version-footer");
    const navSessionValue = document.querySelector("#nav-session-value");
    const versionRect = versionFooter?.getBoundingClientRect?.() || null;

    return {
      visibleText: String(document.body.innerText || "")
        .replace(/\\s+/g, " ")
        .trim(),
      navSessionValue: navSessionValue ? String(navSessionValue.textContent || "").trim() : "",
      versionText: versionFooter ? String(versionFooter.textContent || "").trim() : "",
      versionVisible: isVisible(versionFooter),
      versionBottomLeft: Boolean(
        versionRect &&
          versionRect.left <= Math.max(160, window.innerWidth * 0.2) &&
          window.innerHeight - versionRect.bottom <=
            Math.max(80, window.innerHeight * 0.15),
      ),
    };
  })();`);

  if (screenshotExpectedUser && audit.navSessionValue !== screenshotExpectedUser) {
    throw new Error(
      `Expected the visible session user to be ${screenshotExpectedUser}, got ${audit.navSessionValue || "nothing"}.`,
    );
  }

  const forbiddenTerms = forbiddenVisibleText
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
  const loweredVisibleText = String(audit.visibleText || "").toLowerCase();
  const forbiddenHits = forbiddenTerms.filter((term) =>
    loweredVisibleText.includes(term.toLowerCase()),
  );

  if (forbiddenHits.length > 0) {
    throw new Error(
      `Forbidden visible text detected in the screenshot candidate: ${forbiddenHits.join(", ")}.`,
    );
  }

  if (
    requireVersionFooter &&
    (!audit.versionVisible ||
      !audit.versionBottomLeft ||
      !/^v\d+\.\d+\.\d+/.test(String(audit.versionText || "")))
  ) {
    throw new Error(
      `The application version footer is not clearly visible in the bottom-left corner. Current footer text: ${audit.versionText || "none"}.`,
    );
  }

  const screenshot = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  });

  await writeFile(capturePath, Buffer.from(screenshot.data, "base64"));
} finally {
  socket.close();
  chromeProcess.kill("SIGKILL");
  if (chromeProcess.exitCode === null) {
    await new Promise((resolve) => chromeProcess.once("exit", resolve));
  }
}
NODE
REMOTE_SCRIPT
}

case "$MODE" in
  local)
    SCREENSHOT_URL="${SCREENSHOT_URL:-http://127.0.0.1:8080/}"
    SCREENSHOT_USERNAME="${SCREENSHOT_USERNAME:-}"
    SCREENSHOT_PASSWORD="${SCREENSHOT_PASSWORD:-}"
    run_local_capture
    ;;
  remote)
    run_remote_capture
    ;;
  *)
    echo "Unsupported screenshot mode: $MODE" >&2
    exit 1
    ;;
esac

echo "Updated screenshot at $OUTPUT_PATH."
