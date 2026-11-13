'use client';

import { useEffect } from 'react';
import { Button } from '@water-supply-crm/ui';
import { ErrorState } from '../components/shared/error-state';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Unhandled error', error.digest ?? '', error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-3">
        <ErrorState title="Something went wrong" error={{ response: { data: { message: error.message } } }} />
        <Button className="w-full" onClick={() => reset()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
