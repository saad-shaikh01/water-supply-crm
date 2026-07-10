import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** All identity roles a vendor-dashboard user can hold (mirrors the backend `UserRole` enum). */
export type UserRole = 'SUPER_ADMIN' | 'VENDOR_ADMIN' | 'STAFF' | 'DRIVER' | 'SALESMAN' | 'LOADER' | 'CUSTOMER';

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  vendorId: string;
}

interface AuthState {
  user: AuthUser | null;
  /** False until `StoreHydration` finishes restoring persisted state after mount. */
  isHydrated: boolean;
  setUser: (user: AuthUser) => void;
  clearUser: () => void;
  setHydrated: (hydrated: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isHydrated: false,
      setUser: (user) => set({ user }),
      clearUser: () => set({ user: null }),
      setHydrated: (hydrated) => set({ isHydrated: hydrated }),
    }),
    { name: 'vendor-auth-store', skipHydration: true }
  )
);
