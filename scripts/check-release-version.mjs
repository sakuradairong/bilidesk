#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function read(relative) {
  return readFileSync(join(root, relative), "utf8");
}

const packageVersion = JSON.parse(read("package.json")).version;
const cargoMatch = /^version = "([^"]+)"$/m.exec(read("src-tauri/Cargo.toml"));
const cargoLockMatch = /^name = "bilidesk"\nversion = "([^"]+)"/m.exec(
  read("src-tauri/Cargo.lock"),
);
const tauriVersion = JSON.parse(read("src-tauri/tauri.conf.json")).version;
const srcMatch = /export const APP_VERSION = "([^"]+)";/.exec(
  read("src/lib/version.ts"),
);

const versions = {
  "package.json": packageVersion,
  "src-tauri/Cargo.toml": cargoMatch?.[1],
  "src-tauri/Cargo.lock": cargoLockMatch?.[1],
  "src-tauri/tauri.conf.json": tauriVersion,
  "src/lib/version.ts": srcMatch?.[1],
};

const unique = new Set(Object.values(versions));
if (unique.size !== 1 || ![...unique][0]) {
  console.error("Release version mismatch:");
  for (const [file, version] of Object.entries(versions)) {
    console.error(`  ${file}: ${version ?? "(missing)"}`);
  }
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+$/.test(packageVersion)) {
  console.error(`Invalid semver: ${packageVersion}`);
  process.exit(1);
}

console.log(`release version ${packageVersion}`);
