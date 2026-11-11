import { Suspense } from 'react';
import { WhatsAppPageClient } from '../../../features/whatsapp/components/whatsapp-page-client';

export default function WhatsAppPage() {
  return (
    <Suspense fallback={<div className="rounded-lg border bg-card p-6 text-sm text-muted-foreground">Loading WhatsApp accounts...</div>}>
      <WhatsAppPageClient />
    </Suspense>
  );
}
