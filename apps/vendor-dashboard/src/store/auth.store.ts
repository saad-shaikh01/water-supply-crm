import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Role } from '../lib/rbac';

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  vendorId: string;
}

interface AuthState {
  user: AuthUser | null;
  setUser: (user: AuthUser) => void;
  clearUser: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }),
      clearUser: () => set({ user: null }),
    }),
    { name: 'vendor-auth-store' }
  )
);
