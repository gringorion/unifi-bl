import { HttpError } from "./http-client.js";

const IPV4_SEGMENT = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4_RE = new RegExp(`^${IPV4_SEGMENT}(\\.${IPV4_SEGMENT}){3}$`);

function isValidIpv4(value) {
  return IPV4_RE.test(value);
}

function ipv4ToInteger(value) {
  return value
    .split(".")
    .map((segment) => Number(segment))
    .reduce((result, segment) => ((result << 8) | segment) >>> 0, 0);
}

function integerToIpv4(value) {
  return [24, 16, 8, 0]
    .map((shift) => String((value >>> shift) & 255))
    .join(".");
}

function toNetworkCidr(ip, prefix) {
  if (prefix === 32) {
    return `${ip}/32`;
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = ipv4ToInteger(ip) & mask;
  return `${integerToIpv4(network >>> 0)}/${prefix}`;
}

export function normalizeCidrs(input) {
  const rawValues = Array.isArray(input)
    ? input
    : String(input ?? "")
        .split(/[\n,;]/)
        .map((value) => value.trim());

  const unique = new Set();

  for (const rawValue of rawValues) {
    if (!rawValue) {
      continue;
    }

    let candidate = rawValue.trim();

    if (isValidIpv4(candidate)) {
      candidate = `${candidate}/32`;
    }

    const [ip, mask] = candidate.split("/");
    if (!ip || mask === undefined) {
      throw new HttpError(400, `Invalid CIDR: ${rawValue}`);
    }

    if (!isValidIpv4(ip)) {
      throw new HttpError(400, `Invalid IPv4: ${rawValue}`);
    }

    const prefix = Number(mask);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
      throw new HttpError(400, `Invalid CIDR mask: ${rawValue}`);
    }

    unique.add(toNetworkCidr(ip, prefix));
  }

  return Array.from(unique).sort();
}
