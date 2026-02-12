import { Suspense } from 'react';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Sidebar } from '../../components/layout/sidebar';
import { Header } from '../../components/layout/header';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <div className="flex h-screen bg-muted/20">
        <Sidebar />
        <div className="flex-1 flex flex-col overflow-hidden">
          <Header />
          <main className="flex-1 overflow-y-auto p-6">
            <Suspense fallback={null}>
              {children}
            </Suspense>
          </main>
        </div>
      </div>
    </NuqsAdapter>
  );
}
