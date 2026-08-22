import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/layouts/AppShell";
import { FavoritesPage } from "@/pages/FavoritesPage";
import { FeaturedPage } from "@/pages/FeaturedPage";
import { HistoryPage } from "@/pages/HistoryPage";
import { HomePage } from "@/pages/HomePage";
import { PlayerPage } from "@/pages/PlayerPage";
import { SearchPage } from "@/pages/SearchPage";
import { SettingsPage } from "@/pages/SettingsPage";
import { UserSpacePage } from "@/pages/UserSpacePage";
import { WatchLaterPage } from "@/pages/WatchLaterPage";
import { useSettingsStore } from "@/stores/settings";

export default function App() {
  const loadSettings = useSettingsStore((s) => s.load);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/watch/:bvid" element={<PlayerPage />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/featured" element={<FeaturedPage />} />
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/watchlater" element={<WatchLaterPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/space/:mid" element={<UserSpacePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route
            path="/popular"
            element={<Navigate to="/?tab=hot" replace />}
          />
          <Route
            path="/region"
            element={<Navigate to="/?tab=region" replace />}
          />
          <Route
            path="/dynamic"
            element={<Navigate to="/?tab=dynamic" replace />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster richColors position="top-center" />
    </BrowserRouter>
  );
}
