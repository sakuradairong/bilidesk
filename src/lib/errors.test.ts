import { describe, expect, it } from "vitest";

import { AppError, toAppError } from "@/api";
import { describeUserError } from "./errors";

describe("describeUserError", () => {
  it("maps login expiry to a rescan prompt", () => {
    expect(
      describeUserError(new AppError("unauthenticated", "未登录")),
    ).toBe("登录已过期或尚未登录，请重新扫码登录。");
  });

  it("maps network failures to a retryable offline hint", () => {
    expect(
      describeUserError(new AppError("network", "error sending request")),
    ).toBe("网络不可用或哔哩哔哩接口超时，请检查网络后重试。");
  });

  it("maps missing libmpv to a reinstall hint", () => {
    expect(
      describeUserError(
        new AppError("internal", "未找到 libmpv-2.dll。请把 DLL 放到 vendor"),
      ),
    ).toBe(
      "无法加载播放组件 libmpv。请重新安装 BiliDesk，或检查安装目录中的 vendor/mpv/libmpv-2.dll。",
    );
  });

  it("maps vanished videos and empty play URLs", () => {
    expect(
      describeUserError(new AppError("no_play_url", "未找到可播放地址")),
    ).toBe("没有可播放地址。稿件可能已失效、受版权限制，或当前登录态无法观看。");
    expect(
      describeUserError(new AppError("api", "稿件不存在或已失效 (-404)")),
    ).toBe("稿件不存在或已失效。");
  });

  it("maps risk control and rate limits", () => {
    expect(
      describeUserError(new AppError("risk_control", "请求被风控")),
    ).toBe("请求被哔哩哔哩风控拦截，请稍后重试或重新登录。");
    expect(
      describeUserError(new AppError("message", "操作过于频繁，请稍后再试")),
    ).toBe("请求过于频繁，请稍后再试。");
  });

  it("keeps unknown messages so operators can still diagnose", () => {
    expect(
      describeUserError(new AppError("internal", "unexpected backend panic")),
    ).toBe("unexpected backend panic");
  });
});

describe("toAppError", () => {
  it("rewrites invoke payloads for the UI", () => {
    expect(toAppError({ code: "network", message: "timeout" }).message).toBe(
      "网络不可用或哔哩哔哩接口超时，请检查网络后重试。",
    );
  });
});
