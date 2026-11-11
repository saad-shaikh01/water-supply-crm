'use client';

import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useSessionGuard } from '../hooks/use-session-guard';
import { ErrorState } from '../../../components/shared/error-state';

/** Blocks the dashboard shell until the session is verified as SUPER_ADMIN. */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, error, retry } = useSessionGuard();

  if (status === 'ok') return <>{children}</>;

  if (status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md">
          <ErrorState title="Could not verify your session" error={error} onRetry={retry} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center" role="status" aria-label="Loading">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}
