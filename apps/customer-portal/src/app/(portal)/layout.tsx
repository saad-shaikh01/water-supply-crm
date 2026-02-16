import { Suspense } from 'react';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Header } from '../../components/layout/header';
import { MobileNav } from '../../components/layout/mobile-nav';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <div className="min-h-screen bg-zinc-50/50 dark:bg-zinc-950 selection:bg-primary/20 selection:text-primary">
        <Header />
        
        <main className="max-w-3xl mx-auto px-4 py-8 pb-32 sm:pb-8 relative">
          {/* Background Gradient */}
          <div className="fixed top-0 left-0 right-0 h-96 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none -z-10" />
          
          <Suspense fallback={
            <div className="h-[60vh] flex flex-col items-center justify-center space-y-4">
              <div className="h-10 w-10 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
              <p className="text-sm font-bold text-muted-foreground animate-pulse">Loading Account...</p>
            </div>
          }>
            {children}
          </Suspense>
        </main>

        <MobileNav />
      </div>
    </NuqsAdapter>
  );
}
