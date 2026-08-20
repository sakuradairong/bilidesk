import { create } from "zustand";
import { authLogout, authMe } from "@/api";
import type { Profile } from "@/types";

type AuthState = {
  profile: Profile | null;
  loginOpen: boolean;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
  setLoginOpen: (open: boolean) => void;
  setProfile: (profile: Profile | null) => void;
};

export const useAuthStore = create<AuthState>((set) => ({
  profile: null,
  loginOpen: false,
  setLoginOpen: (open) => set({ loginOpen: open }),
  setProfile: (profile) => set({ profile }),
  refresh: async () => {
    try {
      const me = await authMe();
      set({ profile: me.is_login ? me : null });
    } catch {
      set({ profile: null });
    }
  },
  logout: async () => {
    await authLogout();
    set({ profile: null });
  },
}));
