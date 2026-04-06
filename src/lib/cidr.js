import { HttpError } from "./http-client.js";

const IPV4_SEGMENT = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4_RE = new RegExp(`^${IPV4_SEGMENT}(\\.${IPV4_SEGMENT}){3}$`);
const NON_ROUTABLE_IPV4_CIDRS = [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
  "255.255.255.255/32",
];

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

function normalizeSingleCidr(rawValue) {
  let candidate = String(rawValue ?? "").trim();

  if (!candidate) {
    throw new HttpError(400, "Invalid CIDR: empty value");
  }

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

  return toNetworkCidr(ip, prefix);
}

function getCidrRange(value) {
  const cidr = normalizeSingleCidr(value);
  const [ip, mask] = cidr.split("/");
  const prefix = Number(mask);
  const start = ipv4ToInteger(ip);
  const size = 2 ** (32 - prefix);

  return {
    cidr,
    start,
    end: start + size - 1,
  };
}

function rangesOverlap(left, right) {
  return left.start <= right.end && right.start <= left.end;
}

const NON_ROUTABLE_IPV4_RANGES = NON_ROUTABLE_IPV4_CIDRS.map((cidr) =>
  getCidrRange(cidr),
);

export function isNonRoutableCidr(value) {
  const candidate = getCidrRange(value);
  return NON_ROUTABLE_IPV4_RANGES.some((range) => rangesOverlap(candidate, range));
}

export function filterRoutableCidrs(input) {
  return normalizeCidrs(input).filter((cidr) => !isNonRoutableCidr(cidr));
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

    unique.add(normalizeSingleCidr(rawValue));
  }

  return Array.from(unique).sort();
}
