import { FormEvent, useEffect, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Compass,
  History,
  Search,
  Settings,
  Sparkles,
  Star,
  Clock,
} from "lucide-react";
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
  { to: "/", label: "首页", icon: Compass, end: true },
  { to: "/featured", label: "精选", icon: Sparkles },
  { to: "/favorites", label: "收藏", icon: Star },
  { to: "/watchlater", label: "稍后再看", icon: Clock },
  { to: "/history", label: "历史", icon: History },
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
    <div className="app-shell flex h-full min-h-0 flex-col">
      <header className="app-shell-header grid grid-cols-[minmax(150px,1fr)_auto_minmax(260px,1fr)] items-center gap-4 border-b border-border/70 bg-background/78 px-5 py-3 backdrop-blur-xl">
        <NavLink to="/" className="app-brand min-w-0" aria-label="BiliDesk 首页">
          <span className="app-brand-mark">B</span>
          <span className="min-w-0">
            <strong className="block truncate text-base leading-tight">BiliDesk</strong>
            <small className="block truncate text-[11px] text-muted-foreground">
              非官方 · 个人自用
            </small>
          </span>
        </NavLink>

        <nav className="app-shell-nav" aria-label="主导航">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              aria-label={item.label}
              title={item.label}
              className={({ isActive }) =>
                cn(
                  "app-shell-nav-item",
                  isActive ? "is-active" : "",
                )
              }
            >
              <item.icon className="size-4" />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="flex min-w-0 items-center justify-end gap-2">
          <form
            className="app-search flex min-w-0 flex-1 items-center"
            onSubmit={onSearch}
          >
            <Search className="ml-3 size-4 shrink-0 text-muted-foreground" />
            <Input
              id="app-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索视频…"
              aria-label="搜索视频"
              className="h-10 min-w-0 border-0 bg-transparent shadow-none focus-visible:ring-0"
            />
            <Button
              type="submit"
              variant="ghost"
              size="icon"
              aria-label="提交搜索"
              className="mr-1 size-8 shrink-0 rounded-full"
            >
              <Search className="size-4" />
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
                  <span className="profile-name max-w-24 truncate text-sm">
                    {profile.name}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onClick={() => navigate(`/space/${profile.mid}`)}
                >
                  我的空间
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void logout()}>
                  退出登录
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button className="rounded-full" onClick={() => setLoginOpen(true)}>
              登录
            </Button>
          )}
          <NavLink
            to="/settings"
            aria-label="设置"
            className={({ isActive }) =>
              cn("app-settings-link", isActive && "is-active")
            }
          >
            <Settings className="size-4" />
          </NavLink>
        </div>
      </header>
      <main className="app-shell-content min-h-0 flex-1 overflow-auto px-5 py-5">
        <div className="app-content-frame">
          <Outlet />
        </div>
      </main>
      <LoginModal open={loginOpen} />
    </div>
  );
}
