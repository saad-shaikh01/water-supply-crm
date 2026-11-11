'use client';

import { Button } from '@water-supply-crm/ui';
import { AlertTriangle } from 'lucide-react';
import { apiErrorMessage } from '../../lib/api-error';

interface ErrorStateProps {
  title?: string;
  error: unknown;
  onRetry?: () => void;
}

export function ErrorState({ title = 'Something went wrong', error, onRetry }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-6 py-10 text-center"
    >
      <AlertTriangle className="h-6 w-6 text-destructive" aria-hidden="true" />
      <p className="text-base font-semibold">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">
        {apiErrorMessage(error, 'An unexpected error occurred.')}
      </p>
      {onRetry && (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}
