export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export function buildUrl(baseUrl, pathOrUrl) {
  if (!pathOrUrl) {
    return baseUrl;
  }

  if (/^https?:\/\//i.test(pathOrUrl)) {
    return pathOrUrl;
  }

  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const normalizedPath = String(pathOrUrl).replace(/^\/+/, "");
  return new URL(normalizedPath, normalizedBase).toString();
}

export function applyTemplate(template, variables) {
  return String(template).replace(/\{(\w+)\}/g, (_, key) => {
    if (!(key in variables)) {
      return `{${key}}`;
    }

    return encodeURIComponent(String(variables[key]));
  });
}

function summarizeErrorPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  const parts = [];

  if (typeof payload.message === "string" && payload.message) {
    parts.push(payload.message);
  } else if (typeof payload.error === "string" && payload.error) {
    parts.push(payload.error);
  } else if (typeof payload.raw === "string" && payload.raw) {
    parts.push(payload.raw);
  }

  if (typeof payload.meta?.msg === "string" && payload.meta.msg) {
    parts.push(payload.meta.msg);
  }

  if (typeof payload.meta?.args === "string" && payload.meta.args) {
    parts.push(`args=${payload.meta.args}`);
  }

  return Array.from(new Set(parts.filter(Boolean))).join(" | ");
}

export async function requestJson({
  baseUrl,
  path,
  method = "GET",
  headers = {},
  body,
  timeoutMs = 15000,
}) {
  const url = buildUrl(baseUrl, path);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;

    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    if (!response.ok) {
      const detailSummary = summarizeErrorPayload(data);
      throw new HttpError(
        response.status,
        [
          `UniFi request failed (${response.status}): ${method} ${url}`,
          detailSummary,
        ]
          .filter(Boolean)
          .join(" | "),
        data,
      );
    }

    return {
      status: response.status,
      data,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new HttpError(504, `Timed out during ${method} ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function requestText({
  url,
  method = "GET",
  headers = {},
  timeoutMs = 15000,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method,
      headers,
      signal: controller.signal,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new HttpError(
        response.status,
        `Source URL request failed (${response.status}): ${method} ${url}`,
        { raw: text },
      );
    }

    return {
      status: response.status,
      text,
    };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new HttpError(504, `Timed out during ${method} ${url}`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function unwrapList(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (!payload || typeof payload !== "object") {
    return [];
  }

  const candidates = [
    payload.data,
    payload.items,
    payload.results,
    payload.hosts,
    payload.sites,
    payload.devices,
    payload.clients,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  if (payload.data && typeof payload.data === "object") {
    for (const value of Object.values(payload.data)) {
      if (Array.isArray(value)) {
        return value;
      }
    }
  }

  return [];
}

export function unwrapObject(payload) {
  if (!payload || typeof payload !== "object") {
    return payload;
  }

  return payload.data && typeof payload.data === "object"
    ? payload.data
    : payload;
}

export function getByPath(target, fieldPath) {
  if (!fieldPath) {
    return undefined;
  }

  return String(fieldPath)
    .split(".")
    .reduce((value, key) => {
      if (value && typeof value === "object") {
        return value[key];
      }

      return undefined;
    }, target);
}

export function setByPath(target, fieldPath, value) {
  const keys = String(fieldPath).split(".");
  let cursor = target;

  while (keys.length > 1) {
    const key = keys.shift();
    if (!cursor[key] || typeof cursor[key] !== "object") {
      cursor[key] = {};
    }
    cursor = cursor[key];
  }

  cursor[keys[0]] = value;
}
