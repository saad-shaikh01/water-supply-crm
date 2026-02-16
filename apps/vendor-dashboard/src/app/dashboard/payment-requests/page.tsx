'use client';

import { PageHeader } from '../../../components/shared/page-header';
import { PaymentRequestList } from '../../../features/transactions/components/payment-request-list';

export default function PaymentRequestsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Payment Requests"
        description="Review and approve manual payment proofs submitted by customers."
      />
      <PaymentRequestList />
    </div>
  );
}
