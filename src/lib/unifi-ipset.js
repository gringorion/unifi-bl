export const DEFAULT_UNIFI_IPSET_MAX_ENTRIES = 4000;

export const UNIFI_IPSET_MAX_ENTRIES_OPTIONS = Object.freeze([
  { value: 2000, label: "2000 (USG)" },
  { value: 4000, label: "4000 (Typical)" },
  { value: 8000, label: "8000 (UDM Pro / UXG)" },
]);

const SUPPORTED_UNIFI_IPSET_MAX_ENTRIES = new Set(
  UNIFI_IPSET_MAX_ENTRIES_OPTIONS.map((option) => option.value),
);

export function toUnifiIpSetMaxEntries(
  value,
  fallback = DEFAULT_UNIFI_IPSET_MAX_ENTRIES,
) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function isSupportedUnifiIpSetMaxEntries(value) {
  return SUPPORTED_UNIFI_IPSET_MAX_ENTRIES.has(Number(value));
}

export function getUnifiIpSetMaxEntriesLabel(value) {
  const normalized = Number(value);
  return (
    UNIFI_IPSET_MAX_ENTRIES_OPTIONS.find((option) => option.value === normalized)
      ?.label || String(value)
  );
}
