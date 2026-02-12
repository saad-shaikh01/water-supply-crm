import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CustomerUser {
  id: string;
  name: string;
  email: string;
  customerId: string;
}

interface AuthState {
  user: CustomerUser | null;
  setUser: (user: CustomerUser) => void;
  clearUser: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      setUser: (user) => set({ user }),
      clearUser: () => set({ user: null }),
    }),
    { name: 'customer-auth-store' }
  )
);
