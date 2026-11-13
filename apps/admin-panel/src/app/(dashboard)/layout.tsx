'use client';

import { useState } from 'react';
import { Sidebar, MobileNav } from '../../components/layout/sidebar';
import { Header } from '../../components/layout/header';
import { AuthGate } from '../../features/auth/components/auth-gate';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [navOpen, setNavOpen] = useState(false);
  return (
    <AuthGate>
      <div className="flex h-screen bg-muted/20">
        <Sidebar />
        <MobileNav open={navOpen} onOpenChange={setNavOpen} />
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <Header onMenuClick={() => setNavOpen(true)} menuOpen={navOpen} />
          <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
            {children}
          </main>
        </div>
      </div>
    </AuthGate>
  );
}
