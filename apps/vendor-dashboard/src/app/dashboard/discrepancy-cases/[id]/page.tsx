import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { DiscrepancyCaseDetail } from '../../../../features/discrepancy-cases/components/discrepancy-case-detail';

interface DiscrepancyCasePageProps {
  // Next.js 16 App Router: `params` is a Promise on the page component (see
  // daily-sheets/[id]/page.tsx and fleet/[vanId]/page.tsx for the same
  // pattern). This was previously typed/destructured as a plain sync object
  // — `params.id` was actually `undefined` at runtime, so caseId was
  // undefined, the case-fetch query never fired (enabled: !!id), and the
  // page always rendered "Discrepancy case not found" with no network
  // request to show an error on. No 'use client' needed here either —
  // DiscrepancyCaseDetail already declares its own.
  params: Promise<{ id: string }>;
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

export default async function DiscrepancyCasePage({ params }: DiscrepancyCasePageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-accent/30 animate-pulse" />}>
      <DiscrepancyCaseContent caseId={id} />
    </Suspense>
  );
}
