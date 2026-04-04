import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function defaultData() {
  return {
    version: 2,
    blocklists: [],
  };
}

function normalizeBlocklist(blocklist) {
  return {
    id: blocklist.id,
    name: blocklist.name,
    description: blocklist.description || "",
    enabled: Boolean(blocklist.enabled),
    cidrs: Array.isArray(blocklist.cidrs) ? blocklist.cidrs : [],
    sourceUrl: blocklist.sourceUrl || "",
    refreshInterval: blocklist.refreshInterval || "",
    refreshPaused: Boolean(blocklist.refreshPaused),
    importedCidrs: Array.isArray(blocklist.importedCidrs)
      ? blocklist.importedCidrs
      : [],
    remoteObjectId: blocklist.remoteObjectId || "",
    lastUrlSyncAt: blocklist.lastUrlSyncAt || "",
    lastUrlSyncStatus: blocklist.lastUrlSyncStatus || "never",
    lastUrlSyncError: blocklist.lastUrlSyncError || "",
    lastUnifiSyncAt: blocklist.lastUnifiSyncAt || blocklist.lastSyncAt || "",
    lastUnifiSyncStatus:
      blocklist.lastUnifiSyncStatus || blocklist.lastSyncStatus || "never",
    lastUnifiSyncError:
      blocklist.lastUnifiSyncError || blocklist.lastSyncError || "",
    lastSyncAt: blocklist.lastSyncAt || "",
    lastSyncStatus: blocklist.lastSyncStatus || "never",
    lastSyncError: blocklist.lastSyncError || "",
    createdAt: blocklist.createdAt || new Date().toISOString(),
    updatedAt: blocklist.updatedAt || new Date().toISOString(),
  };
}

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
  }

  async ensure() {
    await mkdir(path.dirname(this.filePath), { recursive: true });

    try {
      await readFile(this.filePath, "utf8");
    } catch {
      await writeFile(
        this.filePath,
        JSON.stringify(defaultData(), null, 2),
        "utf8",
      );
    }
  }

  async read() {
    await this.ensure();
    const raw = await readFile(this.filePath, "utf8");
    const parsed = JSON.parse(raw || "{}");
    const data = {
      ...defaultData(),
      ...parsed,
      blocklists: Array.isArray(parsed.blocklists)
        ? parsed.blocklists.map(normalizeBlocklist)
        : [],
    };

    return data;
  }

  async write(data) {
    await this.ensure();
    const tmpPath = `${this.filePath}.tmp`;
    await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf8");
    await rename(tmpPath, this.filePath);
  }

  async listBlocklists() {
    const data = await this.read();
    return data.blocklists;
  }

  async saveBlocklists(blocklists) {
    const data = await this.read();
    data.blocklists = blocklists.map(normalizeBlocklist);
    await this.write(data);
    return data.blocklists;
  }
}
