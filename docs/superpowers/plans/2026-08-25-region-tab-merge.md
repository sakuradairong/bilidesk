# Region Tab Merge (Approach A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge Discover「排行」into「分区」with 全站 chips, a 刷新榜单 button, and keyboard shortcuts, on top of the ranking/v2 region feed.

**Architecture:** Keep a single Discover region surface. `REGION_CHIPS` = `[{rid:0,name:"全站"}, ...REGION_FEED_REGIONS]`. Home drops the ranking tab and redirects `?tab=ranking` → `?tab=region` (mapping `rankRid`→`rid`). Region page owns refresh + hotkeys; Home only renders the refresh button shell and calls into region via a small callback/ref or lifted refresh token.

**Tech Stack:** React 19, React Router search params, Vitest, existing Tauri `feed_region` / ranking/v2 (WBI).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-25-region-tab-merge-design.md`
- Do not reintroduce `newlist` or `dynamic/region`.
- Do not add Approach B toolbar or Approach C dual-column layout.
- Do not force-push; do not commit unless the user asks (skip per-task commit steps).
- Working tree may already contain uncommitted ranking/v2 region-feed changes — treat Task 0 as landing/verifying that baseline before UI merge work.
- Hotkeys must use `isHotkeyIgnored` from `src/lib/hotkeys.ts`.

## File map

| File | Responsibility |
|---|---|
| `src/lib/regions.ts` | Chip list including 全站; `resolveRegionRid` accepts `0` |
| `src/lib/regions.test.ts` | Rid/chip resolution tests |
| `src/lib/region-hotkeys.ts` | Pure helpers: next/prev rid, digit jump (easy to unit-test) |
| `src/lib/region-hotkeys.test.ts` | Hotkey helper tests |
| `src/pages/RegionPage.tsx` | Chips, feed, refresh API for parent, window keydown |
| `src/pages/HomePage.tsx` | Tabs without 排行; ranking redirect; 刷新榜单 button |
| `src/pages/RankingPage.tsx` | Delete if unused after Home stop mounting it |
| `src/lib/region-feed.ts` | Already single-shot ranking reducer (verify only) |
| Rust `client.rs` / `feed.rs` | Already ranking/v2 (Task 0 verify) |

---

### Task 0: Land / verify ranking/v2 region baseline

**Files:**
- Verify: `src-tauri/src/bili/client.rs`, `src-tauri/src/commands/feed.rs`
- Verify: `src/lib/region-feed.ts`, `src/pages/RegionPage.tsx`

**Interfaces:**
- Produces: `feedRegion(rid, page?)` returns ranking list; region UI has no load-more; OGV rids not in `REGION_FEED_REGIONS`

- [ ] **Step 1: Confirm working tree matches ranking/v2 contract**

Check that `region_newlist` / `feed_region` call `ranking/v2` with WBI and parse `data.list`. If still on `newlist`, apply the already-discussed B2 diff before continuing.

- [ ] **Step 2: Run baseline tests**

Run:

```bash
npx vitest run src/lib/region-feed.test.ts src/lib/regions.test.ts src/lib/errors.test.ts
cargo test --lib region_ --manifest-path src-tauri/Cargo.toml
```

Expected: all pass.

---

### Task 1: Region chips include 全站 (`rid=0`)

**Files:**
- Modify: `src/lib/regions.ts`
- Modify: `src/lib/regions.test.ts`
- Modify: `src/pages/RegionPage.tsx` (use new chip export)

**Interfaces:**
- Produces:
  - `export const REGION_CHIPS: { rid: number; name: string }[]` — `[{ rid: 0, name: "全站" }, ...REGION_FEED_REGIONS]`
  - `resolveRegionRid(value: string | null): number` — accepts `0`; empty/invalid → `REGION_FEED_REGIONS[0].rid` (动画 `1`), **not** `0` (empty URL still defaults to 动画 unless you explicitly choose 全站)
  - Spec clarification for empty `rid`: default remains first UGC chip (`1`), matching prior behavior; only explicit `rid=0` selects 全站.

- [ ] **Step 1: Write failing tests**

In `src/lib/regions.test.ts`, add/adjust:

```ts
import {
  REGION_CHIPS,
  REGION_FEED_REGIONS,
  resolveRegionRid,
} from "./regions";

it("puts 全站 first in REGION_CHIPS", () => {
  expect(REGION_CHIPS[0]).toEqual({ rid: 0, name: "全站" });
  expect(REGION_CHIPS.slice(1)).toEqual(REGION_FEED_REGIONS);
});

it("resolves explicit rid=0 as 全站", () => {
  expect(resolveRegionRid("0")).toBe(0);
});

it("defaults empty rid to first UGC chip, not 全站", () => {
  expect(resolveRegionRid(null)).toBe(REGION_FEED_REGIONS[0].rid);
  expect(resolveRegionRid("")).toBe(REGION_FEED_REGIONS[0].rid);
});
```

Update any existing test that expected `resolveRegionRid("0")` to fall back to 动画 — it must now expect `0`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/regions.test.ts`

Expected: FAIL on missing `REGION_CHIPS` and/or `resolveRegionRid("0")` still falling back.

- [ ] **Step 3: Implement regions helpers**

```ts
export const REGION_CHIPS: { rid: number; name: string }[] = [
  { rid: 0, name: "全站" },
  ...REGION_FEED_REGIONS,
];

export function resolveRegionRid(value: string | null): number {
  const fallback = REGION_FEED_REGIONS[0]?.rid ?? REGIONS[0].rid;
  if (value == null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  if (parsed === 0) return 0;
  if (REGION_FEED_UNSUPPORTED.has(parsed)) return fallback;
  return REGION_FEED_REGIONS.some((region) => region.rid === parsed)
    ? parsed
    : fallback;
}
```

Keep `RANKING_REGIONS` as alias of `REGION_CHIPS` (or `= REGION_CHIPS`) to avoid drift while RankingPage still exists.

- [ ] **Step 4: Point RegionPage chips at REGION_CHIPS**

In `RegionPage.tsx`, render `REGION_CHIPS` instead of `REGION_FEED_REGIONS`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/regions.test.ts`

Expected: PASS.

---

### Task 2: Pure region hotkey helpers

**Files:**
- Create: `src/lib/region-hotkeys.ts`
- Create: `src/lib/region-hotkeys.test.ts`

**Interfaces:**
- Consumes: chip list `{ rid: number }[]`
- Produces:
  - `adjacentRegionRid(chips, currentRid, delta: -1 | 1): number`
  - `regionRidForDigit(chips, digit: number): number | null` — `digit` in `1..9`, maps to `chips[digit - 1]`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  adjacentRegionRid,
  regionRidForDigit,
} from "./region-hotkeys";

const chips = [
  { rid: 0 },
  { rid: 1 },
  { rid: 3 },
  { rid: 4 },
];

describe("adjacentRegionRid", () => {
  it("wraps forward and backward", () => {
    expect(adjacentRegionRid(chips, 4, 1)).toBe(0);
    expect(adjacentRegionRid(chips, 0, -1)).toBe(4);
    expect(adjacentRegionRid(chips, 1, 1)).toBe(3);
  });

  it("falls back to first chip when current is unknown", () => {
    expect(adjacentRegionRid(chips, 999, 1)).toBe(0);
  });
});

describe("regionRidForDigit", () => {
  it("maps 1-based digits onto chips", () => {
    expect(regionRidForDigit(chips, 1)).toBe(0);
    expect(regionRidForDigit(chips, 2)).toBe(1);
    expect(regionRidForDigit(chips, 9)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/region-hotkeys.test.ts`

Expected: FAIL (module missing).

- [ ] **Step 3: Implement helpers**

```ts
export function adjacentRegionRid(
  chips: { rid: number }[],
  currentRid: number,
  delta: -1 | 1,
): number {
  if (chips.length === 0) return currentRid;
  const index = chips.findIndex((chip) => chip.rid === currentRid);
  const from = index >= 0 ? index : 0;
  const next = (from + delta + chips.length) % chips.length;
  return chips[next]!.rid;
}

export function regionRidForDigit(
  chips: { rid: number }[],
  digit: number,
): number | null {
  if (!Number.isInteger(digit) || digit < 1 || digit > 9) return null;
  return chips[digit - 1]?.rid ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/region-hotkeys.test.ts`

Expected: PASS.

---

### Task 3: RegionPage refresh handle + hotkeys

**Files:**
- Modify: `src/pages/RegionPage.tsx`
- Modify: `src/lib/region-feed.ts` only if a refresh bump is needed (prefer remount via `refreshToken`)

**Interfaces:**
- Consumes: `REGION_CHIPS`, `adjacentRegionRid`, `regionRidForDigit`, `isHotkeyIgnored`
- Produces:
  - `RegionFeed` accepts optional `refreshNonce: number` — when it changes, reload page 1 for current rid
  - Parent (Home) increments nonce to refresh
  - Window `keydown` while mounted: `R` refresh, arrows switch rid via `setParams`, `1-9` jump

- [ ] **Step 1: Add refreshNonce prop and reload effect**

```tsx
type RegionFeedProps = {
  refreshNonce?: number;
};

export function RegionFeed({ refreshNonce = 0 }: RegionFeedProps) {
  // existing params / rid ...
  return (
    <div className="flex flex-col gap-4">
      {/* chips from REGION_CHIPS */}
      <RegionFeedContent
        key={`${rid}-${refreshNonce}`}
        rid={rid}
      />
    </div>
  );
}
```

Using `key={`${rid}-${refreshNonce}`}` remounts content and re-fetches without widening the reducer API.

- [ ] **Step 2: Wire keydown in RegionFeed**

```tsx
useEffect(() => {
  function onKey(event: KeyboardEvent) {
    if (isHotkeyIgnored(event.target)) return;
    if (event.key === "r" || event.key === "R") {
      event.preventDefault();
      // parent-owned refresh: cannot bump nonce from here.
      // Prefer custom event or callback prop instead — see Step 3.
    }
  }
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [/* ... */]);
```

Prefer this shape instead:

```tsx
type RegionFeedProps = {
  refreshNonce?: number;
  onRefreshRequest?: () => void;
};

// R → onRefreshRequest?.()
// ArrowLeft → switchRegion(adjacentRegionRid(REGION_CHIPS, rid, -1))
// ArrowRight → switchRegion(adjacentRegionRid(REGION_CHIPS, rid, 1))
// Digit → const next = regionRidForDigit(REGION_CHIPS, Number(event.key)); if (next != null) switchRegion(next)
```

Home owns `refreshNonce` state and passes `onRefreshRequest={() => setRefreshNonce((n) => n + 1)}`.

- [ ] **Step 3: Manual sanity**

With app on `?tab=region&rid=1`, pressing `→` should move rid; remount should fetch.

---

### Task 4: HomePage — drop 排行, redirect, 刷新榜单

**Files:**
- Modify: `src/pages/HomePage.tsx`
- Delete or stop importing: `src/pages/RankingPage.tsx` (delete file if nothing else imports it)

**Interfaces:**
- Consumes: `RegionFeed` with `refreshNonce` + `onRefreshRequest`
- Produces: Discover tabs without `ranking`; ranking URLs redirect

- [ ] **Step 1: Write a small pure redirect helper test (optional but preferred)**

Create `src/lib/discover-tabs.ts` (or keep helper in `regions.ts` if you want fewer files):

```ts
export function normalizeDiscoverSearch(
  params: URLSearchParams,
): URLSearchParams | null {
  if (params.get("tab") !== "ranking") return null;
  const next = new URLSearchParams(params);
  next.set("tab", "region");
  const rankRid = next.get("rankRid");
  if (rankRid != null) {
    next.set("rid", rankRid);
    next.delete("rankRid");
  }
  return next;
}
```

Test:

```ts
it("rewrites ranking tab onto region and maps rankRid", () => {
  const next = normalizeDiscoverSearch(
    new URLSearchParams("tab=ranking&rankRid=4"),
  );
  expect(next?.toString()).toBe("tab=region&rid=4");
});

it("leaves non-ranking params alone", () => {
  expect(normalizeDiscoverSearch(new URLSearchParams("tab=region&rid=1"))).toBeNull();
});
```

- [ ] **Step 2: Implement helper + Home redirect effect**

```tsx
useEffect(() => {
  const next = normalizeDiscoverSearch(params);
  if (next) setParams(next, { replace: true });
}, [params, setParams]);
```

- [ ] **Step 3: Update TABS and refresh button**

```tsx
const TABS = [
  { key: "recommend", label: "推荐" },
  { key: "hot", label: "热门" },
  { key: "region", label: "分区" },
  { key: "dynamic", label: "动态" },
] as const;

const [regionRefreshNonce, setRegionRefreshNonce] = useState(0);
const [regionLoading, setRegionLoading] = useState(false); // optional; can omit and only spin on button if Region reports loading via callback — v1: spin only while nonce just bumped is insufficient. Prefer: button disabled={false} always, or pass loading from RegionFeed via onLoadingChange.

// Minimal v1: local refreshing flag toggled around nonce bump is wrong.
// Better: RegionFeed calls onLoadingChange(boolean).
```

Simplest accepted v1 for the button:

```tsx
{tab === "recommend" ? (
  <Button ...>刷新推荐</Button>
) : null}
{tab === "region" ? (
  <Button
    type="button"
    variant="outline"
    className="home-refresh-button rounded-full"
    onClick={() => setRegionRefreshNonce((n) => n + 1)}
  >
    <RefreshCw className="size-4" aria-hidden="true" />
    刷新榜单
  </Button>
) : null}
```

Optional polish: `RegionFeed` reports loading with `onLoadingChange` so the button can disable + spin — implement if cheap.

Remove `RankingFeed` import and `{tab === "ranking" ? ...}` branch.

Delete `src/pages/RankingPage.tsx` if unused (`rg RankingFeed` / `RankingPage` should be empty).

- [ ] **Step 4: Fix TabKey handling**

`raw === "ranking"` must not stick as an unknown tab: either redirect runs first, or treat unknown tabs as recommend **after** redirect. Prefer redirect effect before render selection:

```tsx
const tab: TabKey = TABS.some((t) => t.key === raw)
  ? (raw as TabKey)
  : "recommend";
```

While `tab=ranking` briefly exists, `TABS.some` is false → would flash recommend before redirect. Avoid by computing:

```tsx
const effectiveParams = normalizeDiscoverSearch(params) ?? params;
const raw = effectiveParams.get("tab");
```

and always `setParams` when normalize returns non-null (effect). Also use `effectiveParams` for RegionFeed if needed.

---

### Task 5: Verification

**Files:** none (commands only)

- [ ] **Step 1: Unit tests**

```bash
npx vitest run src/lib/regions.test.ts src/lib/region-hotkeys.test.ts src/lib/region-feed.test.ts src/lib/errors.test.ts
cargo test --lib region_ --manifest-path src-tauri/Cargo.toml
```

Expected: all pass.

- [ ] **Step 2: Manual App checklist**

1. Discover tabs show 推荐/热门/分区/动态 only.
2. Open `/?tab=ranking&rankRid=4` → lands on 分区 · 游戏.
3. Chips include 全站; selecting 全站 sets `rid=0` and loads list.
4. 刷新榜单 remounts/refetches.
5. Outside inputs: `R` refreshes; `←`/`→` cycle chips; `1` selects 全站.
6. No「加载更多」 on region grid.

---

## Spec coverage self-review

| Spec requirement | Task |
|---|---|
| Remove 排行 tab | Task 4 |
| Redirect ranking → region + rankRid→rid | Task 4 |
| 全站 + UGC chips; no OGV chips | Task 1 |
| ranking/v2 data, no load-more, ranked grid | Task 0 (baseline) |
| 刷新榜单 button | Task 4 (+ Task 3 nonce) |
| Hotkeys R / arrows / 1–9 + isHotkeyIgnored | Task 2 + Task 3 |
| vitest + cargo region_ green | Task 5 |
| No newlist / no Approach B/C | Global Constraints |

## Placeholder scan

No TBD/TODO placeholders. Commit steps omitted per repo preference.
