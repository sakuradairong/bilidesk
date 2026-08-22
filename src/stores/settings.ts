import { create } from "zustand";
import { settingsGetAll, settingsSet } from "@/api";
import type { ThemeMode } from "@/types";

/** BiliOne 风格可选主题色 */
export const ACCENTS: { key: string; label: string; color: string }[] = [
  { key: "pink", label: "B 站粉", color: "oklch(0.62 0.17 8)" },
  { key: "cyan", label: "青色", color: "oklch(0.65 0.11 215)" },
  { key: "blue", label: "蓝色", color: "oklch(0.55 0.16 262)" },
  { key: "purple", label: "紫色", color: "oklch(0.55 0.16 300)" },
  { key: "green", label: "绿色", color: "oklch(0.6 0.13 150)" },
];

type SettingsState = {
  loaded: boolean;
  theme: ThemeMode;
  accent: string;
  danmakuEnabled: boolean;
  danmakuFontSize: number;
  danmakuMaxRows: number;
  danmakuOpacity: number;
  danmakuArea: number;
  danmakuBold: boolean;
  defaultVolume: number;
  defaultSpeed: number;
  autoPlayNext: boolean;
  resumePosition: boolean;
  load: () => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  setAccent: (accent: string) => Promise<void>;
  setKey: (key: string, value: string) => Promise<void>;
};

function parseTheme(raw?: string): ThemeMode {
  return raw === "dark" || raw === "system" || raw === "light" ? raw : "light";
}

function parseAccent(raw?: string): string {
  return ACCENTS.some((a) => a.key === raw) ? (raw as string) : "pink";
}

function applyAccent(accent: string) {
  document.documentElement.dataset.accent = accent;
}

function parseNumber(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  const dark =
    theme === "dark" ||
    (theme === "system" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
}

let systemThemeBound = false;
function bindSystemTheme() {
  if (systemThemeBound || typeof window === "undefined") return;
  systemThemeBound = true;
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => {
      if (useSettingsStore.getState().theme === "system") applyTheme("system");
    });
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  loaded: false,
  theme: "light",
  accent: "pink",
  danmakuEnabled: true,
  danmakuFontSize: 42,
  danmakuMaxRows: 10,
  danmakuOpacity: 1,
  danmakuArea: 1,
  danmakuBold: true,
  defaultVolume: 80,
  defaultSpeed: 1,
  autoPlayNext: true,
  resumePosition: true,
  load: async () => {
    try {
      const all = await settingsGetAll();
      const theme = parseTheme(all.theme);
      const accent = parseAccent(all.accent_color);
      bindSystemTheme();
      applyTheme(theme);
      applyAccent(accent);
      set({
        loaded: true,
        theme,
        accent,
        danmakuEnabled: all.danmaku_enabled !== "false",
        danmakuFontSize: parseNumber(all.danmaku_font_size, 42),
        danmakuMaxRows: parseNumber(all.danmaku_max_rows, 10),
        danmakuOpacity: parseNumber(all.danmaku_opacity, 1),
        danmakuArea: parseNumber(all.danmaku_area, 1),
        danmakuBold: all.danmaku_bold !== "false",
        defaultVolume: parseNumber(all.default_volume, 80),
        defaultSpeed: parseNumber(all.default_speed, 1),
        autoPlayNext: all.auto_play_next !== "false",
        resumePosition: all.resume_position !== "false",
      });
    } catch {
      applyTheme("light");
      applyAccent("pink");
      set({ loaded: true });
    }
  },
  setTheme: async (theme) => {
    applyTheme(theme);
    set({ theme });
    await settingsSet("theme", theme);
  },
  setAccent: async (accent) => {
    applyAccent(accent);
    set({ accent });
    await settingsSet("accent_color", accent);
  },
  setKey: async (key, value) => {
    await settingsSet(key, value);
    const next = { ...get() };
    if (key === "danmaku_enabled") next.danmakuEnabled = value !== "false";
    if (key === "danmaku_font_size")
      next.danmakuFontSize = parseNumber(value, get().danmakuFontSize);
    if (key === "danmaku_max_rows")
      next.danmakuMaxRows = parseNumber(value, get().danmakuMaxRows);
    if (key === "danmaku_opacity")
      next.danmakuOpacity = parseNumber(value, get().danmakuOpacity);
    if (key === "danmaku_area")
      next.danmakuArea = parseNumber(value, get().danmakuArea);
    if (key === "danmaku_bold") next.danmakuBold = value !== "false";
    if (key === "default_volume")
      next.defaultVolume = parseNumber(value, get().defaultVolume);
    if (key === "default_speed")
      next.defaultSpeed = parseNumber(value, get().defaultSpeed);
    if (key === "auto_play_next") next.autoPlayNext = value !== "false";
    if (key === "resume_position") next.resumePosition = value !== "false";
    set(next);
  },
}));
