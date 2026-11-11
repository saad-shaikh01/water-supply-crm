import { Suspense } from 'react';
import { AuditPageClient } from '../../../features/audit/components/audit-page-client';

export default function AuditLogsPage() {
  return (
    <Suspense fallback={<div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Loading audit logs...</div>}>
      <AuditPageClient />
    </Suspense>
  );
}
