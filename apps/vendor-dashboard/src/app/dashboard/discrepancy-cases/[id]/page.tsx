'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { DiscrepancyCaseDetail } from '../../../../features/discrepancy-cases/components/discrepancy-case-detail';

interface DiscrepancyCasePageProps {
  params: { id: string };
}

function DiscrepancyCaseContent({ caseId }: { caseId: string }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/discrepancy-cases">
          <Button variant="ghost" size="sm" className="rounded-xl gap-1.5 font-semibold text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            Back to Discrepancy Cases
          </Button>
        </Link>
      </div>
      <DiscrepancyCaseDetail caseId={caseId} />
    </div>
  );
}

export default function DiscrepancyCasePage({ params }: DiscrepancyCasePageProps) {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-accent/30 animate-pulse" />}>
      <DiscrepancyCaseContent caseId={params.id} />
    </Suspense>
  );
}
