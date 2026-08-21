import { FormEvent, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { Compass, History, Settings, Sparkles } from "lucide-react";
import { LoginModal } from "@/components/LoginModal";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { mediaSrc } from "@/media";
import { useAuthStore } from "@/stores/auth";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "推荐", icon: Compass, end: true },
  { to: "/featured", label: "精选", icon: Sparkles },
  { to: "/history", label: "历史", icon: History },
  { to: "/settings", label: "设置", icon: Settings },
];

export function AppShell() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const profile = useAuthStore((s) => s.profile);
  const loginOpen = useAuthStore((s) => s.loginOpen);
  const setLoginOpen = useAuthStore((s) => s.setLoginOpen);
  const logout = useAuthStore((s) => s.logout);
  const refresh = useAuthStore((s) => s.refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  function onSearch(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  }

  return (
    <div className="app-shell grid h-full min-h-0 grid-cols-[220px_1fr]">
      <aside className="app-shell-aside flex min-h-0 flex-col gap-2 border-r border-border/80 bg-card/70 px-3 py-5 backdrop-blur-md">
        <div className="mb-3 px-3">
          <div className="font-display text-xl font-bold tracking-tight">BiliDesk</div>
          <div className="text-xs text-muted-foreground">非官方 · 个人自用</div>
        </div>
        <nav className="flex flex-col gap-1">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )
              }
            >
              <item.icon className="size-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="app-shell-main flex min-h-0 min-w-0 flex-col">
        <header className="app-shell-header flex items-center gap-3 border-b border-border/80 bg-background/70 px-5 py-3 backdrop-blur-md">
          <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={onSearch}>
            <Input
              id="app-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索视频…"
              aria-label="搜索视频"
              className="max-w-xl bg-card/80"
            />
            <Button type="submit" variant="secondary">
              搜索
            </Button>
          </form>
          {profile ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2">
                  <Avatar className="size-7">
                    <AvatarImage src={mediaSrc(profile.face)} alt="" />
                    <AvatarFallback>{profile.name.slice(0, 1)}</AvatarFallback>
                  </Avatar>
                  <span className="max-w-28 truncate text-sm">{profile.name}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void logout()}>退出登录</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button onClick={() => setLoginOpen(true)}>登录</Button>
          )}
        </header>
        <main className="app-shell-content min-h-0 flex-1 overflow-auto p-5">
          <Outlet />
        </main>
      </div>
      <LoginModal open={loginOpen} />
    </div>
  );
}
