import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settings";
import type { ThemeMode } from "@/types";

export function SettingsPage() {
  const theme = useSettingsStore((s) => s.theme);
  const danmakuEnabled = useSettingsStore((s) => s.danmakuEnabled);
  const danmakuFontSize = useSettingsStore((s) => s.danmakuFontSize);
  const danmakuMaxRows = useSettingsStore((s) => s.danmakuMaxRows);
  const defaultVolume = useSettingsStore((s) => s.defaultVolume);
  const defaultSpeed = useSettingsStore((s) => s.defaultSpeed);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setKey = useSettingsStore((s) => s.setKey);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">设置</h1>
        <p className="text-sm text-muted-foreground">主题、弹幕与播放默认值会写入本地数据库</p>
      </div>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card/70 p-5 shadow-sm">
        <h2 className="text-sm font-semibold">外观</h2>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="theme">主题</Label>
          <Select value={theme} onValueChange={(v) => void setTheme(v as ThemeMode)}>
            <SelectTrigger id="theme" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="light">浅色</SelectItem>
              <SelectItem value="dark">深色</SelectItem>
              <SelectItem value="system">跟随系统</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card/70 p-5 shadow-sm">
        <h2 className="text-sm font-semibold">弹幕</h2>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="dm-on">默认开启弹幕</Label>
          <Switch
            id="dm-on"
            checked={danmakuEnabled}
            onCheckedChange={(checked) => void setKey("danmaku_enabled", checked ? "true" : "false")}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="dm-font">默认字号</Label>
          <Select
            value={String(danmakuFontSize)}
            onValueChange={(v) => void setKey("danmaku_font_size", v)}
          >
            <SelectTrigger id="dm-font" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="36">小</SelectItem>
              <SelectItem value="42">中</SelectItem>
              <SelectItem value="56">大</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="dm-rows">默认密度</Label>
          <Select
            value={String(danmakuMaxRows)}
            onValueChange={(v) => void setKey("danmaku_max_rows", v)}
          >
            <SelectTrigger id="dm-rows" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="8">稀</SelectItem>
              <SelectItem value="10">中</SelectItem>
              <SelectItem value="16">密</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card/70 p-5 shadow-sm">
        <h2 className="text-sm font-semibold">播放</h2>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="vol">默认音量</Label>
          <Select
            value={String(defaultVolume)}
            onValueChange={(v) => void setKey("default_volume", v)}
          >
            <SelectTrigger id="vol" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">50</SelectItem>
              <SelectItem value="80">80</SelectItem>
              <SelectItem value="100">100</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="speed">默认倍速</Label>
          <Select
            value={String(defaultSpeed)}
            onValueChange={(v) => void setKey("default_speed", v)}
          >
            <SelectTrigger id="speed" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">1x</SelectItem>
              <SelectItem value="1.25">1.25x</SelectItem>
              <SelectItem value="1.5">1.5x</SelectItem>
              <SelectItem value="2">2x</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>
    </div>
  );
}
