'use client';

import { useEffect } from 'react';
import { Button } from '@water-supply-crm/ui';
import { ErrorState } from '../../components/shared/error-state';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Dashboard error', error.digest ?? '', error);
  }, [error]);

  return (
    <div className="mx-auto w-full max-w-lg space-y-3 py-10">
      <ErrorState title="This page failed to load" error={{ response: { data: { message: error.message } } }} />
      <Button className="w-full" onClick={() => reset()}>
        Try again
      </Button>
    </div>
  );
}
