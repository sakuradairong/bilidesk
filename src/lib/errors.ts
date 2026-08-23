type ErrorLike = { code: string; message: string };

const COPY: Record<string, string> = {
  unauthenticated: "登录已过期或尚未登录，请重新扫码登录。",
  network: "网络不可用或哔哩哔哩接口超时，请检查网络后重试。",
  risk_control: "请求被哔哩哔哩风控拦截，请稍后重试或重新登录。",
  vip_required:
    "该清晰度需要大会员，已尽量回退到当前账号可用的最高清晰度。",
  mpv_missing:
    "无法加载播放组件 libmpv。请重新安装 BiliDesk，或检查安装目录中的 vendor/mpv/libmpv-2.dll。",
  no_play_url:
    "没有可播放地址。稿件可能已失效、受版权限制，或当前登录态无法观看。",
  video_unavailable: "稿件不存在或已失效。",
  rate_limited: "请求过于频繁，请稍后再试。",
  cancelled: "播放已取消。",
};

function inferredCode(error: ErrorLike): string {
  if (error.code in COPY) return error.code;
  const text = error.message;
  if (text.includes("未登录") || text.includes("登录过期")) {
    return "unauthenticated";
  }
  if (text.includes("libmpv") || text.includes("mpv-2.dll")) {
    return "mpv_missing";
  }
  if (
    text.includes("稿件不存在") ||
    text.includes("已失效") ||
    text.includes("啥都木有")
  ) {
    return "video_unavailable";
  }
  if (text.includes("过于频繁") || text.includes("限流")) {
    return "rate_limited";
  }
  if (text.includes("风控")) {
    return "risk_control";
  }
  return error.code;
}

export function describeUserError(error: ErrorLike): string {
  return COPY[inferredCode(error)] ?? error.message;
}
