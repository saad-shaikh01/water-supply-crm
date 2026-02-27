'use client';

import { Suspense } from 'react';
import { PageHeader } from '../../../components/shared/page-header';
import { DeliveryIssuesInbox } from '../../../features/delivery-issues/components/delivery-issues-inbox';

function DeliveryIssuesContent() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Delivery Issues"
        description="Triage failed deliveries, assign owners, and drive retry/closure workflow."
      />
      <DeliveryIssuesInbox />
    </div>
  );
}

export default function DeliveryIssuesPage() {
  return (
    <Suspense fallback={<div className="h-64 rounded-2xl bg-accent/30 animate-pulse" />}>
      <DeliveryIssuesContent />
    </Suspense>
  );
}
