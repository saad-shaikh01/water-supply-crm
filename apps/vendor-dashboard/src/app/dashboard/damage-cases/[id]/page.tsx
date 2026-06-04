'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { Button } from '@water-supply-crm/ui';
import { DamageCaseDetail } from '../../../../features/damage-cases/components/damage-case-detail';

interface DamageCasePageProps {
  params: { id: string };
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

export default function DamageCasePage({ params }: DamageCasePageProps) {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-accent/30 animate-pulse" />}>
      <DamageCaseContent caseId={params.id} />
    </Suspense>
  );
}
