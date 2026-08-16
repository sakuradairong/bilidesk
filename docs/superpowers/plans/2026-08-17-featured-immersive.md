# Featured Immersive Implementation Plan

> **For agentic workers:** Execute inline in this session. Prefer TDD for Rust parsers/forms. User asked not to auto-commit unless requested — skip per-task git commits.

**Goal:** Add a 精选 page that plays `CLIENT_SELECTED` rcmd as a full-window libmpv feed with overlay chrome and like/coin/fav/danmaku/comment.

**Architecture:** New `BiliClient::selected` + interact POSTs; keep `PlayerPage` for grid playback; `FeaturedPage` drives the existing player commands with a full-window transparent stage.

**Tech Stack:** Tauri 2, React 19, Rust, existing reqwest WBI client.

## Global Constraints

- Do not send `mobi_app=pc_electron`, `web_location=bilibili-electron`, or `x-app-version`.
- Do not use official logo or the name 哔哩哔哩 as app identity.
- No live, download, VIP bypass.
- No git commit unless the user asks.

## File map

- Modify: `src-tauri/src/bili/models.rs`, `client.rs`, `commands.rs`, `lib.rs`, `player.rs` / `mpv.rs` (speed)
- Modify: `src/types.ts`, `src/api.ts`, `src/App.tsx`, `src/components/Sidebar.tsx`, `src/styles.css`
- Create: `src/pages/FeaturedPage.tsx`

### Task 1: Parse CLIENT_SELECTED cards

Tests in `client.rs`: keep cards with cid>0 and bvid; drop missing cid. Implement `selected` + extend `VideoCard`.

### Task 2: Interact helpers

Tests for csrf required; like like=1/2; reply list parser. Implement POST form + commands.

### Task 3: Player speed

`player_set_speed` via existing mpv command channel.

### Task 4: Featured UI

Sidebar entry, overlay CSS, FeaturedPage next/prev/autoplay, interaction buttons, comment drawer.

### Task 5: Verify

`cargo test --lib` and `npm run build` (or tsc) if available.
