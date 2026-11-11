'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Global error', error.digest ?? '', error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '4rem 1rem', textAlign: 'center' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Something went wrong</h1>
        <p style={{ color: '#6b7280', margin: '0.5rem 0 1.5rem' }}>
          An unexpected error occurred. Please try again.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{ padding: '0.5rem 1rem', borderRadius: '0.375rem', border: '1px solid #d1d5db', cursor: 'pointer' }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
