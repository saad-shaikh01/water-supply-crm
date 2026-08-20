import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { DamageCaseDetail } from '../../../../features/damage-cases/components/damage-case-detail';

interface DamageCasePageProps {
  // Next.js 16 App Router: `params` is a Promise on the page component (see
  // daily-sheets/[id]/page.tsx and fleet/[vanId]/page.tsx for the same
  // pattern). Same "not found" bug as discrepancy-cases/[id]/page.tsx (this
  // file was copy-pasted from it) — no 'use client' needed either,
  // DamageCaseDetail already declares its own.
  params: Promise<{ id: string }>;
}

function DamageCaseContent({ caseId }: { caseId: string }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/dashboard/damage-cases">
          <Button variant="ghost" size="sm" className="rounded-xl gap-1.5 font-semibold text-muted-foreground hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
            Back to Damage Cases
          </Button>
        </Link>
      </div>
      <DamageCaseDetail caseId={caseId} />
    </div>
  );
}

export default async function DamageCasePage({ params }: DamageCasePageProps) {
  const { id } = await params;
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-accent/30 animate-pulse" />}>
      <DamageCaseContent caseId={id} />
    </Suspense>
  );
}
