import Link from 'next/link';
import { cn } from '@water-supply-crm/ui';

/**
 * Renders a customer's name as a link to their detail page when an id is
 * available, otherwise a plain span. Safe to use anywhere a customer name is
 * shown — falls back gracefully when the id is missing.
 */
export function CustomerLink({
  id,
  name,
  className,
}: {
  id?: string | null;
  name?: string | null;
  className?: string;
}) {
  const text = name ?? '—';
  if (!id) return <span className={className}>{text}</span>;
  return (
    <Link
      href={`/dashboard/customers/${id}`}
      className={cn('hover:text-primary hover:underline transition-colors', className)}
    >
      {text}
    </Link>
  );
}
