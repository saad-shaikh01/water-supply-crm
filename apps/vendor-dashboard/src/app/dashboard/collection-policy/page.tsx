'use client';

import { Loader2 } from 'lucide-react';
import { PageHeader } from '../../../components/shared/page-header';
import { CollectionPolicyForm } from '../../../features/collection-policy/components/collection-policy-form';
import { useCollectionPolicy } from '../../../features/collection-policy/hooks/use-collection-policy';

export default function CollectionPolicyPage() {
  const { data, isLoading } = useCollectionPolicy();

  return (
    <div>
      <PageHeader
        title="Collection Policy"
        description="Set a minimum-collection floor for Monthly customers, evaluated against their remaining previous month outstanding balance."
      />

      {isLoading || !data ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading policy…
        </div>
      ) : (
        <CollectionPolicyForm policy={data} />
      )}
    </div>
  );
}
