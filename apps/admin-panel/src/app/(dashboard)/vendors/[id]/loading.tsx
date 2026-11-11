import { Skeleton } from '@water-supply-crm/ui';

export default function VendorDetailLoading() {
  return (
    <div className="space-y-6" aria-busy="true">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-10 w-full max-w-xl" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
    </div>
  );
}
