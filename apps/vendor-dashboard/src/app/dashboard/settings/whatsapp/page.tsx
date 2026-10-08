'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@water-supply-crm/ui';
import { PageHeader } from '../../../../components/shared/page-header';
import { useAuthStore } from '../../../../store/auth.store';
import { WhatsAppAccountEditor } from '../../../../features/whatsapp-account/components/whatsapp-account-editor';
import { useVendorPicker } from '../../../../features/company-profile/hooks/use-company-profile';
import { GoLiveChecklist } from '../../../../features/onboarding/components/go-live-checklist';

export default function WhatsAppSettingsPage() {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [vendorId, setVendorId] = useState('');
  const vendors = useVendorPicker(isSuperAdmin);

  return (
    <>
      <PageHeader
        title="WhatsApp"
        description="The WhatsApp Business number your customers receive receipts, statements and reminders from."
      />
      <div className="space-y-6 pb-4">
        <GoLiveChecklist />
        {isSuperAdmin && (
          <Card>
            <CardContent className="flex flex-col gap-2 pt-6 sm:flex-row sm:items-center">
              <label htmlFor="wa-vendor-picker" className="text-sm font-semibold sm:w-48">
                Editing vendor
              </label>
              <select
                id="wa-vendor-picker"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
                className="h-11 w-full rounded-md border border-border/50 bg-accent/30 px-3 text-sm sm:max-w-md"
              >
                <option value="">{vendors.isLoading ? 'Loading vendors…' : 'Select a vendor…'}</option>
                {(vendors.data ?? []).map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
              {vendors.isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            </CardContent>
          </Card>
        )}

        {isSuperAdmin ? (
          vendorId ? (
            <WhatsAppAccountEditor key={vendorId} vendorId={vendorId} isSuperAdmin />
          ) : (
            <p className="text-sm text-muted-foreground">Choose a vendor to view or manage its WhatsApp number.</p>
          )
        ) : (
          <WhatsAppAccountEditor />
        )}
      </div>
    </>
  );
}
