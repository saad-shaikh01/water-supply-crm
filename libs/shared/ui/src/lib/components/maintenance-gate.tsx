'use client';

import { useEffect, useState } from 'react';

/** Must match MAINTENANCE_EVENT in @water-supply-crm/data-access (kept as a literal: ui must not depend on data-access). */
const MAINTENANCE_EVENT = 'platform:maintenance';

interface Detail {
  message?: string;
  eta?: string | null;
}

/**
 * Full-screen notice shown when the API reports 503 MAINTENANCE_MODE. The shared axios client dispatches a
 * `platform:maintenance` CustomEvent; mount this once in an app root layout. Renders nothing otherwise.
 * The admin panel never mounts it (platform admins keep working during maintenance).
 */
export function MaintenanceGate() {
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => {
    const onEvent = (e: Event) => setDetail((e as CustomEvent<Detail>).detail ?? {});
    window.addEventListener(MAINTENANCE_EVENT, onEvent);
    return () => window.removeEventListener(MAINTENANCE_EVENT, onEvent);
  }, []);

  if (!detail) return null;

  const eta = detail.eta ? new Date(detail.eta) : null;
  const etaText = eta && !Number.isNaN(eta.getTime()) ? eta.toLocaleString() : null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="maintenance-gate"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-background p-6 text-center"
    >
      <div className="max-w-md space-y-3">
        <h1 className="text-2xl font-bold">We&apos;ll be right back</h1>
        <p className="text-muted-foreground">
          {detail.message || 'The service is undergoing scheduled maintenance. Please try again shortly.'}
        </p>
        {etaText && <p className="text-sm text-muted-foreground">Expected back: {etaText}</p>}
        <button
          type="button"
          className="mt-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          onClick={() => window.location.reload()}
        >
          Try again
        </button>
      </div>
    </div>
  );
}
