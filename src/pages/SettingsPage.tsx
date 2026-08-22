import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ACCENTS, useSettingsStore } from "@/stores/settings";
import type { ThemeMode } from "@/types";
import { cn } from "@/lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ExternalLink, ShieldCheck } from "lucide-react";

const PROJECT_URL = "https://github.com/sakuradairong/bilidesk";

export function SettingsPage() {
  const theme = useSettingsStore((s) => s.theme);
  const accent = useSettingsStore((s) => s.accent);
  const danmakuEnabled = useSettingsStore((s) => s.danmakuEnabled);
  const danmakuFontSize = useSettingsStore((s) => s.danmakuFontSize);
  const danmakuMaxRows = useSettingsStore((s) => s.danmakuMaxRows);
  const danmakuOpacity = useSettingsStore((s) => s.danmakuOpacity);
  const danmakuArea = useSettingsStore((s) => s.danmakuArea);
  const danmakuBold = useSettingsStore((s) => s.danmakuBold);
  const defaultVolume = useSettingsStore((s) => s.defaultVolume);
  const defaultSpeed = useSettingsStore((s) => s.defaultSpeed);
  const autoPlayNext = useSettingsStore((s) => s.autoPlayNext);
  const resumePosition = useSettingsStore((s) => s.resumePosition);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const setAccent = useSettingsStore((s) => s.setAccent);
  const setKey = useSettingsStore((s) => s.setKey);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          设置
        </h1>
        <p className="text-sm text-muted-foreground">
          主题、弹幕与播放默认值会写入本地数据库
        </p>
      </div>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card/70 p-5 shadow-sm">
        <h2 className="text-sm font-semibold">外观</h2>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="theme">主题</Label>
          <Select
            value={theme}
            onValueChange={(v) => void setTheme(v as ThemeMode)}
          >
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
        <div className="flex items-center justify-between gap-4">
          <Label>主题色</Label>
          <div className="flex gap-2">
            {ACCENTS.map((item) => (
              <button
                key={item.key}
                type="button"
                title={item.label}
                aria-label={item.label}
                aria-pressed={accent === item.key}
                onClick={() => void setAccent(item.key)}
                className={cn(
                  "size-7 rounded-full transition-transform hover:scale-110",
                  accent === item.key &&
                    "ring-2 ring-ring ring-offset-2 ring-offset-card",
                )}
                style={{ background: item.color }}
              />
            ))}
          </div>
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card/70 p-5 shadow-sm">
        <h2 className="text-sm font-semibold">弹幕</h2>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="dm-on">默认开启弹幕</Label>
          <Switch
            id="dm-on"
            checked={danmakuEnabled}
            onCheckedChange={(checked) =>
              void setKey("danmaku_enabled", checked ? "true" : "false")
            }
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
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="dm-opacity">透明度</Label>
          <Select
            value={String(danmakuOpacity)}
            onValueChange={(v) => void setKey("danmaku_opacity", v)}
          >
            <SelectTrigger id="dm-opacity" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">不透明</SelectItem>
              <SelectItem value="0.75">75%</SelectItem>
              <SelectItem value="0.5">半透明</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="dm-area">显示区域</Label>
          <Select
            value={String(danmakuArea)}
            onValueChange={(v) => void setKey("danmaku_area", v)}
          >
            <SelectTrigger id="dm-area" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">全屏</SelectItem>
              <SelectItem value="0.5">半屏</SelectItem>
              <SelectItem value="0.25">顶部 1/4</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="dm-bold">字体加粗</Label>
          <Switch
            id="dm-bold"
            checked={danmakuBold}
            onCheckedChange={(checked) =>
              void setKey("danmaku_bold", checked ? "true" : "false")
            }
          />
        </div>
        <p className="text-xs text-muted-foreground">
          弹幕样式对下一个打开的视频生效
        </p>
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
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="auto-next">自动连播</Label>
            <p className="text-xs text-muted-foreground">
              播完自动播放下一P或相关推荐
            </p>
          </div>
          <Switch
            id="auto-next"
            checked={autoPlayNext}
            onCheckedChange={(checked) =>
              void setKey("auto_play_next", checked ? "true" : "false")
            }
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <div>
            <Label htmlFor="resume">断点续播</Label>
            <p className="text-xs text-muted-foreground">
              从上次离开的位置继续（本地保存）
            </p>
          </div>
          <Switch
            id="resume"
            checked={resumePosition}
            onCheckedChange={(checked) =>
              void setKey("resume_position", checked ? "true" : "false")
            }
          />
        </div>
      </section>

      <section className="flex flex-col gap-4 rounded-xl border border-border bg-card/70 p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-5 text-primary" aria-hidden="true" />
          <div>
            <h2 className="text-sm font-semibold">关于与隐私</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              BiliDesk 0.1.0 · 非官方客户端。登录 Cookie 使用 Windows
              当前用户范围的 DPAPI 加密，本项目不收集遥测数据。
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void openUrl(`${PROJECT_URL}/blob/master/PRIVACY.md`)}
          >
            隐私说明
            <ExternalLink aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void openUrl(`${PROJECT_URL}/security/advisories/new`)}
          >
            安全报告
            <ExternalLink aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void openUrl(PROJECT_URL)}
          >
            项目主页
            <ExternalLink aria-hidden="true" />
          </Button>
        </div>
      </section>
    </div>
  );
}
