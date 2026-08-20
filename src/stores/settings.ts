import { create } from "zustand";
import { settingsGetAll, settingsSet } from "@/api";
import type { ThemeMode } from "@/types";

type SettingsState = {
  loaded: boolean;
  theme: ThemeMode;
  danmakuEnabled: boolean;
  danmakuFontSize: number;
  danmakuMaxRows: number;
  defaultVolume: number;
  defaultSpeed: number;
  load: () => Promise<void>;
  setTheme: (theme: ThemeMode) => Promise<void>;
  setKey: (key: string, value: string) => Promise<void>;
};

function applyTheme(theme: ThemeMode) {
  const root = document.documentElement;
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.classList.toggle("dark", dark);
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  loaded: false,
  theme: "light",
  danmakuEnabled: true,
  danmakuFontSize: 42,
  danmakuMaxRows: 10,
  defaultVolume: 80,
  defaultSpeed: 1,
  load: async () => {
    try {
      const all = await settingsGetAll();
      const theme = (all.theme as ThemeMode) || "light";
      applyTheme(theme);
      set({
        loaded: true,
        theme,
        danmakuEnabled: all.danmaku_enabled !== "false",
        danmakuFontSize: Number(all.danmaku_font_size || 42),
        danmakuMaxRows: Number(all.danmaku_max_rows || 10),
        defaultVolume: Number(all.default_volume || 80),
        defaultSpeed: Number(all.default_speed || 1),
      });
    } catch {
      applyTheme("light");
      set({ loaded: true });
    }
  },
  setTheme: async (theme) => {
    applyTheme(theme);
    set({ theme });
    await settingsSet("theme", theme);
  },
  setKey: async (key, value) => {
    await settingsSet(key, value);
    const next = { ...get() };
    if (key === "danmaku_enabled") next.danmakuEnabled = value !== "false";
    if (key === "danmaku_font_size") next.danmakuFontSize = Number(value);
    if (key === "danmaku_max_rows") next.danmakuMaxRows = Number(value);
    if (key === "default_volume") next.defaultVolume = Number(value);
    if (key === "default_speed") next.defaultSpeed = Number(value);
    set(next);
  },
}));
