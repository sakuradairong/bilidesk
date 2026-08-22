# 第三方组件

BiliDesk 自有代码采用 MIT License。下列组件不属于 BiliDesk 的 MIT 授权范围。

BiliDesk 安装包会动态加载并捆绑 [libmpv](https://mpv.io/)（`libmpv-2.dll`）。当前构建使用 [zhongfly/mpv-winbuild](https://github.com/zhongfly/mpv-winbuild) 的 LGPL 构建：

- release：`2026-08-21-49418246f3`
- asset：`mpv-dev-lgpl-x86_64-20260821-git-49418246f3.7z`
- archive SHA-256：`317dfd9ee814be76e5f6e20b45efcc07440389a62b55dd85201829b4880510e0`

下载脚本会校验上述哈希。升级版本时必须同时更新 release、资源名、哈希和本文件。

BiliDesk 通过运行时动态加载 `libmpv-2.dll`，不会把 libmpv 静态链接进应用可执行文件。用户可以使用接口兼容的 LGPL 构建替换安装目录中的 `vendor/mpv/libmpv-2.dll`。对应源代码、构建脚本与许可证可从上述固定 release、[mpv 源码仓库](https://github.com/mpv-player/mpv)和 [FFmpeg 源码仓库](https://github.com/FFmpeg/FFmpeg)获取。安装包同时附带 `licenses/LGPL-2.1.txt`、`licenses/LGPL-3.0.txt` 与 `licenses/GPL-3.0.txt`。

源码与许可证：

- https://github.com/mpv-player/mpv
- https://github.com/FFmpeg/FFmpeg
- https://github.com/zhongfly/mpv-winbuild/releases/tag/2026-08-21-49418246f3

本应用不是哔哩哔哩官方产品。
