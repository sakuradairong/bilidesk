# BiliDesk 现代化重写设计

**日期：** 2026-08-21  
**方案：** 同仓就地重写（方案 1）

## 决策摘要

- UI：React + Tailwind + shadcn，浅色优先双主题，SaaS 桌面感
- 后端：领域命令模块 + SQLite；Cookie 文件兼容；历史 JSON 迁移
- 功能：现有能力 + 设置页 + 空/错状态 + 快捷键增强
- 非目标：直播、下载、破解、伪装官方客户端

## 架构

见实现：`src-tauri/src/commands/{auth,feed,video,social,player,settings}.rs`、`src-tauri/src/storage`、`src/layouts/AppShell.tsx`。

## 数据

- `bilidesk.db`：`history`、`settings`、`schema_migrations`
- 旧 `history.json` → 导入后改名为 `history.json.migrated`
- `session.json` 继续存放 Cookie
