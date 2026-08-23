#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

function normalizeNewlines(text) {
  return text.replace(/\r\n?/g, "\n");
}

export function parseReleaseVersions({
  packageJson,
  cargoToml,
  cargoLock,
  tauriConf,
  versionTs,
}) {
  cargoToml = normalizeNewlines(cargoToml);
  cargoLock = normalizeNewlines(cargoLock);
  versionTs = normalizeNewlines(versionTs);

  const packageVersion = JSON.parse(packageJson).version;
  const cargoMatch = /^version = "([^"]+)"$/m.exec(cargoToml);
  const cargoLockMatch = /^name = "bilidesk"\nversion = "([^"]+)"/m.exec(
    cargoLock,
  );
  const tauriVersion = JSON.parse(tauriConf).version;
  const srcMatch = /export const APP_VERSION = "([^"]+)";/.exec(versionTs);

  return {
    "package.json": packageVersion,
    "src-tauri/Cargo.toml": cargoMatch?.[1],
    "src-tauri/Cargo.lock": cargoLockMatch?.[1],
    "src-tauri/tauri.conf.json": tauriVersion,
    "src/lib/version.ts": srcMatch?.[1],
  };
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(relative) {
  return readFileSync(join(root, relative), "utf8");
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return (
      fileURLToPath(import.meta.url).toLowerCase() ===
      resolve(entry).toLowerCase()
    );
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const versions = parseReleaseVersions({
    packageJson: read("package.json"),
    cargoToml: read("src-tauri/Cargo.toml"),
    cargoLock: read("src-tauri/Cargo.lock"),
    tauriConf: read("src-tauri/tauri.conf.json"),
    versionTs: read("src/lib/version.ts"),
  });

  const unique = new Set(Object.values(versions));
  if (unique.size !== 1 || ![...unique][0]) {
    console.error("Release version mismatch:");
    for (const [file, version] of Object.entries(versions)) {
      console.error(`  ${file}: ${version ?? "(missing)"}`);
    }
    process.exit(1);
  }

  const packageVersion = versions["package.json"];
  if (!/^\d+\.\d+\.\d+$/.test(packageVersion)) {
    console.error(`Invalid semver: ${packageVersion}`);
    process.exit(1);
  }

  console.log(`release version ${packageVersion}`);
}
