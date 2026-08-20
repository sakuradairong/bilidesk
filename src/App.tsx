import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { AppShell } from "@/layouts/AppShell";
import { FeaturedPage } from "@/pages/FeaturedPage";
import { HistoryPage } from "@/pages/HistoryPage";
import { HomePage } from "@/pages/HomePage";
import { PlayerPage } from "@/pages/PlayerPage";
import { SearchPage } from "@/pages/SearchPage";
import { SettingsPage } from "@/pages/SettingsPage";
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
          <Route path="/search" element={<SearchPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
      <Toaster richColors position="top-center" />
    </BrowserRouter>
  );
}
