'use client';

import { Sidebar } from '../../components/layout/sidebar';
import { Header } from '../../components/layout/header';
import { AuthGate } from '../../features/auth/components/auth-gate';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGate>
      <div className="flex h-screen bg-muted/20">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto p-6">
            {children}
          </main>
        </div>
      </div>
    </AuthGate>
  );
}
