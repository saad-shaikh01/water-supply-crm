import { Suspense } from 'react';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Sidebar } from '../../components/layout/sidebar';
import { Header } from '../../components/layout/header';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <div className="flex h-screen bg-background overflow-hidden selection:bg-primary selection:text-white">
        {/* Desktop Sidebar */}
        <Sidebar className="hidden md:flex w-72 flex-col shrink-0" />
        
        <div className="flex-1 flex flex-col min-w-0">
          <Header />
          <main className="flex-1 overflow-y-auto overflow-x-hidden relative scroll-smooth">
            <div className="max-w-7xl mx-auto p-4 md:p-8 relative z-10">
              <Suspense fallback={
                <div className="h-[60vh] flex flex-col items-center justify-center space-y-4 animate-in fade-in duration-500">
                  <div className="h-12 w-12 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                  <p className="text-sm font-bold text-muted-foreground animate-pulse">Loading Dashboard...</p>
                </div>
              }>
                {children}
              </Suspense>
            </div>
          </main>
        </div>
      </div>
    </NuqsAdapter>
  );
}
