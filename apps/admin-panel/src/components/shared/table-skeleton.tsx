import { Skeleton } from '@water-supply-crm/ui';

interface TableSkeletonProps {
  rows?: number;
  cols?: number;
}

export function TableSkeleton({ rows = 5, cols = 4 }: TableSkeletonProps) {
  return (
    <div className="space-y-2" data-testid="table-skeleton" aria-busy="true">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} data-testid="skeleton-row" className="flex gap-3">
          {Array.from({ length: cols }).map((__, c) => (
            <Skeleton key={c} className="h-10 flex-1 rounded-md" />
          ))}
        </div>
      ))}
    </div>
  );
}
