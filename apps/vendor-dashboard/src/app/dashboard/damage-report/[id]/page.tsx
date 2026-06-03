'use client';

import { Suspense } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ChevronLeft, ShieldAlert } from 'lucide-react';
import { DamageCaseUpdateForm } from '../../../../features/driver/components/damage-case-update-form';

export default function DamageCaseDetailPage() {
  const params = useParams();
  const id = typeof params.id === 'string' ? params.id : Array.isArray(params.id) ? params.id[0] : '';

  return (
    <Suspense>
      <div className="space-y-6 max-w-2xl">
        {/* Back link */}
        <Link
          href="/dashboard/damage-report"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Damage Report
        </Link>

        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-primary/10">
            <ShieldAlert className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Case Details</h1>
            <p className="text-xs font-mono text-muted-foreground mt-0.5 truncate">{id}</p>
          </div>
        </div>

        <DamageCaseUpdateForm caseId={id} />
      </div>
    </Suspense>
  );
}
