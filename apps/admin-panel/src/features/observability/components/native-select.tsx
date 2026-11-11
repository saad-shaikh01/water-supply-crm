import type { SelectHTMLAttributes } from 'react';

/** Plain <select> styled like our inputs: reliable on mobile and trivially testable. */
export function NativeSelect({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${className}`}
      {...props}
    />
  );
}
