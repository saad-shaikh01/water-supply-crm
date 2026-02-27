import { Suspense } from 'react';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Header } from '../../components/layout/header';
import { MobileNav } from '../../components/layout/mobile-nav';
import { FcmTokenManager } from '../../features/notifications/components/fcm-token-manager';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <div className="min-h-screen bg-background selection:bg-primary/20 selection:text-primary">
        <FcmTokenManager />
        <Header />
        
        <main className="max-w-3xl mx-auto px-4 py-8 pb-32 sm:pb-8 relative">
          <Suspense fallback={
            <div className="h-[60vh] flex flex-col items-center justify-center space-y-4">
              <div className="h-10 w-10 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
              <p className="text-sm font-bold text-muted-foreground">Loading Account...</p>
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
