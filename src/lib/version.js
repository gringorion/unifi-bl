import path from "node:path";
import { existsSync, readFileSync } from "node:fs";

const SEMVER_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

function readTrimmedFile(filePath) {
  if (!existsSync(filePath)) {
    return "";
  }

  try {
    return String(readFileSync(filePath, "utf8") || "").trim();
  } catch {
    return "";
  }
}

export function isSemverVersion(value) {
  return SEMVER_VERSION_PATTERN.test(String(value || "").trim());
}

export function readVersionFile(cwd) {
  return readTrimmedFile(path.join(cwd, "VERSION"));
}

export function readPackageVersion(cwd) {
  try {
    const packageJsonPath = path.join(cwd, "package.json");
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    return String(packageJson.version || "").trim();
  } catch {
    return "";
  }
}

export function readAppVersion(cwd) {
  const versionFile = readVersionFile(cwd);
  if (isSemverVersion(versionFile)) {
    return versionFile;
  }

  const packageVersion = readPackageVersion(cwd);
  if (isSemverVersion(packageVersion)) {
    return packageVersion;
  }

  return "0.0.0";
}

export { SEMVER_VERSION_PATTERN };
