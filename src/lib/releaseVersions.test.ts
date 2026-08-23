import { describe, expect, it } from "vitest";

import { parseReleaseVersions } from "./releaseVersions";

const lfFiles = {
  packageJson: '{"version":"1.0.0"}',
  cargoToml: '[package]\nname = "bilidesk"\nversion = "1.0.0"\n',
  cargoLock: '[[package]]\nname = "bilidesk"\nversion = "1.0.0"\n',
  tauriConf: '{"version":"1.0.0"}',
  versionTs: 'export const APP_VERSION = "1.0.0";\n',
};

function toCrlf(text: string) {
  return text.replace(/\n/g, "\r\n");
}

describe("parseReleaseVersions", () => {
  it("reads matching 1.0.0 versions from LF files", () => {
    expect(parseReleaseVersions(lfFiles)["src-tauri/Cargo.lock"]).toBe("1.0.0");
  });

  it("reads Cargo.lock version when GitHub Windows runners check out CRLF", () => {
    const crlfFiles = {
      packageJson: lfFiles.packageJson,
      cargoToml: toCrlf(lfFiles.cargoToml),
      cargoLock: toCrlf(lfFiles.cargoLock),
      tauriConf: lfFiles.tauriConf,
      versionTs: toCrlf(lfFiles.versionTs),
    };

    expect(parseReleaseVersions(crlfFiles)).toEqual({
      "package.json": "1.0.0",
      "src-tauri/Cargo.toml": "1.0.0",
      "src-tauri/Cargo.lock": "1.0.0",
      "src-tauri/tauri.conf.json": "1.0.0",
      "src/lib/version.ts": "1.0.0",
    });
  });
});
