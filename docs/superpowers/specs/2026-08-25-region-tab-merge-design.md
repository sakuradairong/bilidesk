# Region tab merge (Approach A) — Design

Date: 2026-08-25  
Status: Approved  
Branch context: `fix/ui-foundation` (region feed already on `ranking/v2`)

## Goal

Collapse the duplicate Discover entries **排行** and **分区** into a single **分区** tab. Keep the ranking/v2 data source, add an explicit refresh control, and add keyboard shortcuts for power users.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Scope of controls | Action button **and** keyboard shortcuts |
| Tab strategy | Keep **分区**, remove **排行** |
| Chip set | **全站** (`rid=0`) + existing UGC region chips |
| Visual approach | Light merge (Approach A): reuse existing Discover chrome |

## Information architecture

- Home pill tabs become: 推荐 / 热门 / **分区** / 动态.
- Remove the **排行** tab from `HomePage` `TABS`.
- Deep-link compatibility:
  - `?tab=ranking` → redirect to `?tab=region`.
  - If `rankRid` is present, map it to `rid` and drop `rankRid`.
  - Unsupported OGV ids (`13`, `167`, `168`) continue to resolve to the first UGC chip (动画), consistent with ranking support.

## Data

- Feed: existing `feed_region` / `ranking/v2` (WBI).
- `rid=0` means 全站 (same contract as today’s `feed_ranking(0)`).
- No pagination / no「加载更多」 (single ranking payload).
- Grid remains `ranked` (ordinal badges).

## UI

### Region chips

- Order: `全站`, then `REGION_FEED_REGIONS` (动画、音乐、舞蹈、游戏…).
- Active chip follows URL `rid`.
- Switching chips remounts/refetches that rid (existing `key={rid}` pattern).

### Refresh button

- When Discover tab === `region`, show **刷新榜单** beside the heading actions (same outline + `RefreshCw` pattern as「刷新推荐」).
- Click re-requests the current `rid`.
- While loading: button disabled, icon spins, label「刷新中…」.
- Recommend tab keeps「刷新推荐」; other tabs show no refresh button.

### Empty / error

- Keep region-specific empty copy (排行内容 / 切换分区).
- Failed loads keep retry via existing `onRetry` / `failedPage` path.

## Keyboard shortcuts

Active only while Discover tab === `region`. Ignore when `isHotkeyIgnored(target)` is true (inputs, contenteditable, dialogs, etc.).

| Key | Action |
|---|---|
| `R` | Refresh current region ranking |
| `←` | Previous chip (wrap) |
| `→` | Next chip (wrap) |
| `1`–`9` | Jump to chip index 1–9 when that chip exists |

No persistent on-screen shortcut legend in v1 (keep the heading uncluttered).

## Code touchpoints

- `src/pages/HomePage.tsx` — drop ranking tab; region refresh button; ranking→region redirect.
- `src/pages/RegionPage.tsx` — chips include 全站; expose refresh + hotkeys (or small hook).
- `src/lib/regions.ts` — `resolveRegionRid` accepts `0`; export chip list used by region UI.
- `src/pages/RankingPage.tsx` — stop mounting from Home; keep file only if still useful as shared helper, otherwise delete unused entry.
- Tests: `regions.test.ts`, region-feed tests, Home/redirect coverage as needed.

## Out of scope

- Reintroducing `newlist` / `dynamic/region`.
- Approach B toolbar (browser open, always-visible shortcut hint).
- Approach C dual-column layout.
- Changing Ranking vs Region backend beyond using the already-shared ranking/v2 path.

## Success criteria

1. 「排行」tab is gone from Discover.
2. Old `?tab=ranking` links land on 分区 with the correct rid when possible.
3. 全站 + UGC chips work; OGV ids do not appear as chips.
4. 刷新榜单 refreshes the active rid.
5. Hotkeys `R` / arrows / `1–9` work outside ignored targets.
6. Existing vitest + `cargo test --lib region_` stay green.
