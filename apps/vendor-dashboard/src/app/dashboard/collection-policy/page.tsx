'use client';

import { Loader2 } from 'lucide-react';
import { PageHeader } from '../../../components/shared/page-header';
import { CollectionPolicyForm } from '../../../features/collection-policy/components/collection-policy-form';
import { CashCollectionPolicyForm } from '../../../features/collection-policy/components/cash-collection-policy-form';
import { useCollectionPolicy, useCashCollectionPolicy } from '../../../features/collection-policy/hooks/use-collection-policy';

export default function CollectionPolicyPage() {
  const { data: monthlyPolicy, isLoading: monthlyLoading } = useCollectionPolicy();
  const { data: cashPolicy, isLoading: cashLoading } = useCashCollectionPolicy();

  return (
    <div>
      <PageHeader
        title="Collection Policy"
        description="Control how much credit Monthly and Cash customers may carry before a delivery requires payment."
      />

      <div className="space-y-6">
        {monthlyLoading || !monthlyPolicy ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading Monthly policy…
          </div>
        ) : (
          <CollectionPolicyForm policy={monthlyPolicy} />
        )}

        {cashLoading || !cashPolicy ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading Cash policy…
          </div>
        ) : (
          <CashCollectionPolicyForm policy={cashPolicy} />
        )}
      </div>
    </div>
  );
}
