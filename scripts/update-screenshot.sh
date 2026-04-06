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
        }
      }
      END {
        print port;
        print username;
        print password;
      }
    ' '$REMOTE_DIR/.env' 2>/dev/null || printf '8080\n\n\n'"
}

run_local_capture() {
  mkdir -p "$(dirname "$OUTPUT_PATH")"

  docker run --rm -i --network host \
    -e SCREENSHOT_URL="$SCREENSHOT_URL" \
    -e SCREENSHOT_USERNAME="$SCREENSHOT_USERNAME" \
    -e SCREENSHOT_PASSWORD="$SCREENSHOT_PASSWORD" \
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
    const footer = document.querySelector(".page-footer");
    if (footer) {
      footer.remove();
    }

    const logoutButton = document.querySelector("#logout-button");
    if (logoutButton) {
      logoutButton.setAttribute("hidden", "");
    }

    const sessionValue = document.querySelector("#nav-session-value");
    if (sessionValue) {
      sessionValue.textContent = "Signed in";
    }

    const authModal = document.querySelector("#auth-status-modal");
    if (authModal) {
      authModal.classList.remove("is-open");
      authModal.setAttribute("hidden", "");
    }

    return true;
  })();`);

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
  local remote_values=""

  if [[ -z "${SCREENSHOT_URL:-}" || -z "${SCREENSHOT_USERNAME:-}" || -z "${SCREENSHOT_PASSWORD:-}" ]]; then
    remote_values="$(read_remote_runtime_values)"
    remote_port="$(printf '%s\n' "$remote_values" | sed -n '1p')"
    remote_username="$(printf '%s\n' "$remote_values" | sed -n '2p')"
    remote_password="$(printf '%s\n' "$remote_values" | sed -n '3p')"
  fi

  SCREENSHOT_URL="${SCREENSHOT_URL:-http://127.0.0.1:${remote_port:-8080}/}"
  SCREENSHOT_USERNAME="${SCREENSHOT_USERNAME:-$remote_username}"
  SCREENSHOT_PASSWORD="${SCREENSHOT_PASSWORD:-$remote_password}"

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
SCREENSHOT_URL="$2"
SCREENSHOT_USERNAME="$3"
SCREENSHOT_PASSWORD="$4"
SCREENSHOT_VIEWPORT_WIDTH="$5"
SCREENSHOT_VIEWPORT_HEIGHT="$6"
SCREENSHOT_TIMEOUT_MS="$7"
SCREENSHOT_DEBUG_PORT="$8"
SCREENSHOT_CAPTURE_PATH="/tmp/unifi-bl-screenshot.png"

docker run --rm -i --network host \
  -e SCREENSHOT_URL="$SCREENSHOT_URL" \
  -e SCREENSHOT_USERNAME="$SCREENSHOT_USERNAME" \
  -e SCREENSHOT_PASSWORD="$SCREENSHOT_PASSWORD" \
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
    const footer = document.querySelector(".page-footer");
    if (footer) {
      footer.remove();
    }

    const logoutButton = document.querySelector("#logout-button");
    if (logoutButton) {
      logoutButton.setAttribute("hidden", "");
    }

    const sessionValue = document.querySelector("#nav-session-value");
    if (sessionValue) {
      sessionValue.textContent = "Signed in";
    }

    const authModal = document.querySelector("#auth-status-modal");
    if (authModal) {
      authModal.classList.remove("is-open");
      authModal.setAttribute("hidden", "");
    }

    return true;
  })();`);

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
