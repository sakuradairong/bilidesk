import { create } from "zustand";
import { authLogout, authMe } from "@/api";
import type { Profile } from "@/types";

type AuthState = {
  profile: Profile | null;
  authReady: boolean;
  loginOpen: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setLoginOpen: (open: boolean) => void;
  setProfile: (profile: Profile | null) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  profile: null,
  authReady: false,
  loginOpen: false,
  setLoginOpen: (open) => set({ loginOpen: open }),
  setProfile: (profile) => set({ profile, authReady: true }),
  refresh: async () => {
    try {
      const me = await authMe();
      set({ profile: me.is_login ? me : null, authReady: true });
    } catch {
      set({ profile: null, authReady: true });
    }
  },
  logout: async () => {
    try {
      await authLogout();
    } finally {
      set({ profile: null, authReady: true });
    }
  },
}));
