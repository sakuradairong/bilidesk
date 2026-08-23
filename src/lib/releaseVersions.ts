export type ReleaseVersionFiles = {
  packageJson: string;
  cargoToml: string;
  cargoLock: string;
  tauriConf: string;
  versionTs: string;
};

export type ReleaseVersions = {
  "package.json": string | undefined;
  "src-tauri/Cargo.toml": string | undefined;
  "src-tauri/Cargo.lock": string | undefined;
  "src-tauri/tauri.conf.json": string | undefined;
  "src/lib/version.ts": string | undefined;
};

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

/** Keep in sync with scripts/check-release-version.mjs. */
export function parseReleaseVersions({
  packageJson,
  cargoToml,
  cargoLock,
  tauriConf,
  versionTs,
}: ReleaseVersionFiles): ReleaseVersions {
  cargoToml = normalizeNewlines(cargoToml);
  cargoLock = normalizeNewlines(cargoLock);
  versionTs = normalizeNewlines(versionTs);

  const packageVersion = JSON.parse(packageJson).version as string | undefined;
  const cargoMatch = /^version = "([^"]+)"$/m.exec(cargoToml);
  const cargoLockMatch = /^name = "bilidesk"\nversion = "([^"]+)"/m.exec(
    cargoLock,
  );
  const tauriVersion = JSON.parse(tauriConf).version as string | undefined;
  const srcMatch = /export const APP_VERSION = "([^"]+)";/.exec(versionTs);

  return {
    "package.json": packageVersion,
    "src-tauri/Cargo.toml": cargoMatch?.[1],
    "src-tauri/Cargo.lock": cargoLockMatch?.[1],
    "src-tauri/tauri.conf.json": tauriVersion,
    "src/lib/version.ts": srcMatch?.[1],
  };
}
