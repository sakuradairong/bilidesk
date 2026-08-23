export const APP_VERSION = "1.0.0";
export const PROJECT_URL = "https://github.com/sakuradairong/bilidesk";
export const RELEASES_URL = `${PROJECT_URL}/releases`;
export const DATA_DIR_HINT = "%APPDATA%\\com.bilidesk.desktop";

export function aboutBlurb(version = APP_VERSION): string {
  return `BiliDesk ${version} · 非官方客户端。登录 Cookie 使用 Windows 当前用户范围的 DPAPI 加密，本项目不收集遥测数据。`;
}

export function nsisInstallerName(version = APP_VERSION): string {
  return `BiliDesk_${version}_x64-setup.exe`;
}
