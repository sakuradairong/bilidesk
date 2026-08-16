import { useCallback, useEffect, useState } from "react";
import { authLogout, authMe, feedRecommend, feedSearch, historyList } from "./api";
import { LoginModal } from "./components/LoginModal";
import { Sidebar } from "./components/Sidebar";
import { TopBar } from "./components/TopBar";
import { VideoGridPage } from "./pages/VideoGridPage";
import { PlayerPage } from "./pages/PlayerPage";
import { FeaturedPage } from "./pages/FeaturedPage";
import type { HistoryItem, PageId, Profile, VideoCard } from "./types";
import "./styles.css";

export default function App() {
  const [page, setPage] = useState<PageId>("home");
  const [query, setQuery] = useState("");
  const [playing, setPlaying] = useState<string | null>(null);
  const [loginOpen, setLoginOpen] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [homeItems, setHomeItems] = useState<VideoCard[]>([]);
  const [searchItems, setSearchItems] = useState<VideoCard[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [homeIdx, setHomeIdx] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const refreshProfile = useCallback(async () => {
    try {
      const me = await authMe();
      setProfile(me.is_login ? me : null);
    } catch {
      setProfile(null);
    }
  }, []);

  const loadHome = useCallback(async (idx: number, append = false) => {
    setLoading(true);
    setError("");
    try {
      const items = await feedRecommend(idx);
      setHomeItems((prev) => (append ? [...prev, ...items] : items));
      setHomeIdx(idx);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshProfile();
    void loadHome(1);
  }, [loadHome, refreshProfile]);

  async function handleSearch(keyword: string) {
    setPage("search");
    setLoading(true);
    setError("");
    try {
      const result = await feedSearch(keyword, 1);
      setSearchItems(result.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function handlePage(next: PageId) {
    setPage(next);
    if (next === "history") {
      try {
        setHistoryItems(await historyList());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }

  async function logout() {
    await authLogout();
    setProfile(null);
  }

  if (playing) {
    return <PlayerPage bvid={playing} onBack={() => setPlaying(null)} />;
  }

  const historyCards: VideoCard[] = historyItems.map((item) => ({
    bvid: item.bvid,
    title: item.title,
    cover: item.cover,
    owner: item.owner,
    duration: 0,
    views: 0,
  }));

  return (
    <div className="shell">
      <Sidebar page={page} onChange={(next) => void handlePage(next)} />
      <div className="main">
        <TopBar
          query={query}
          onQuery={setQuery}
          onSearch={(value) => void handleSearch(value)}
          profile={profile}
          onLogin={() => setLoginOpen(true)}
          onLogout={() => void logout()}
        />
        <div className="content">
          {page === "home" && (
            <VideoGridPage
              items={homeItems}
              loading={loading}
              error={error}
              onOpen={setPlaying}
              onMore={() => void loadHome(homeIdx + 1, true)}
            />
          )}
          {page === "search" && (
            <VideoGridPage items={searchItems} loading={loading} error={error} onOpen={setPlaying} />
          )}
          {page === "featured" && (
            <FeaturedPage onNeedLogin={() => setLoginOpen(true)} loginOpen={loginOpen} />
          )}
          {page === "history" && (
            <VideoGridPage items={historyCards} loading={false} error={error} onOpen={setPlaying} />
          )}
        </div>
      </div>
      {loginOpen ? (
        <LoginModal
          onClose={() => setLoginOpen(false)}
          onLoggedIn={(next) => setProfile(next)}
        />
      ) : null}
    </div>
  );
}
