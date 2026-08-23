import { describe, expect, it } from "vitest";

import { aboutBlurb, APP_VERSION, nsisInstallerName } from "./version";

describe("release version helpers", () => {
  it("embeds the current version in the about line", () => {
    expect(aboutBlurb("1.0.0")).toBe(
      "BiliDesk 1.0.0 · 非官方客户端。登录 Cookie 使用 Windows 当前用户范围的 DPAPI 加密，本项目不收集遥测数据。",
    );
  });

  it("names the NSIS installer after the version", () => {
    expect(nsisInstallerName("1.0.0")).toBe("BiliDesk_1.0.0_x64-setup.exe");
  });

  it("exports a semver that is not a placeholder", () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_VERSION).not.toBe("0.0.0");
  });
});
