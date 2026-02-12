import { Suspense } from 'react';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { Header } from '../../components/layout/header';

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <div className="min-h-screen bg-muted/20">
        <Header />
        <main className="max-w-3xl mx-auto px-4 py-6 pb-20 sm:pb-6">
          <Suspense fallback={null}>{children}</Suspense>
        </main>
      </div>
    </NuqsAdapter>
  );
}
