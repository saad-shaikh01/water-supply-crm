'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { cn } from '@water-supply-crm/ui';
import { PageHeader } from '../../../../components/shared/page-header';
import { isPlanning, isRunning, useImportDetail } from '../../../../features/data-import/hooks/use-data-import';
import { isDraft } from '../../../../features/data-import/components/format';
import { MappingStep } from '../../../../features/data-import/components/mapping-step';
import { ReviewStep } from '../../../../features/data-import/components/review-step';
import { PlanningStep, ProgressStep, ResultStep } from '../../../../features/data-import/components/run-and-result-step';

const STEPS = ['Upload', 'Map columns', 'Review', 'Import'];

function Stepper({ active }: { active: number }) {
  return (
    <ol className="flex flex-wrap items-center gap-2 mb-6">
      {STEPS.map((s, i) => (
        <li
          key={s}
          className={cn(
            'flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-semibold',
            i === active ? 'bg-primary text-primary-foreground' : i < active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          <span className="text-xs">{i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}

export default function ImportBatchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: detail, isLoading, isError } = useImportDetail(id);
  const [editMapping, setEditMapping] = useState(false);

  const back = (
    <Link href="/dashboard/data-import" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4">
      <ArrowLeft className="h-4 w-4" /> All imports
    </Link>
  );

  if (isLoading) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin inline mr-2" />
        Loading import…
      </div>
    );
  }
  if (isError || !detail) {
    return (
      <>
        {back}
        <p className="text-sm text-destructive">This import could not be found.</p>
      </>
    );
  }

  const { batch, wizard } = detail;

  if (batch.status === 'CANCELLED') {
    return (
      <>
        {back}
        <PageHeader title="Import cancelled" description="This draft was cancelled and its data removed." />
      </>
    );
  }

  if (isPlanning(batch)) {
    return (
      <>
        {back}
        <PageHeader title="Building the preview" description={`${batch.sourceFileName} · ${batch.rowCount.toLocaleString()} rows`} />
        <Stepper active={2} />
        <PlanningStep batch={batch} />
      </>
    );
  }

  if (isRunning(batch)) {
    return (
      <>
        {back}
        <PageHeader title="Importing" description={batch.sourceFileName} />
        <ProgressStep batch={batch} />
      </>
    );
  }

  if (isDraft(batch.status) && wizard) {
    const mapping = batch.status === 'UPLOADED' || editMapping;
    return (
      <>
        {back}
        <PageHeader
          title={mapping ? 'Match your columns' : 'Review before importing'}
          description={`${batch.sourceFileName} · ${batch.rowCount.toLocaleString()} rows`}
        />
        <Stepper active={mapping ? 1 : 2} />
        {mapping ? (
          <MappingStep key={`map-${batch.updatedAt}`} batchId={batch.id} data={wizard} onPlanned={() => setEditMapping(false)} />
        ) : (
          <ReviewStep
            detail={detail}
            onBack={() => setEditMapping(true)}
            onExecuted={() => undefined}
            onCancelled={() => router.push('/dashboard/data-import')}
          />
        )}
      </>
    );
  }

  return (
    <>
      {back}
      <PageHeader title="Import details" description="What was imported, what was skipped, and why." />
      <ResultStep detail={detail} />
    </>
  );
}
