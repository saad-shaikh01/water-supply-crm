'use client';

import Link from 'next/link';
import { useQueryState, parseAsString } from 'nuqs';
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@water-supply-crm/ui';
import { useVendor } from '../../hooks/use-vendor-detail';
import { VendorHeader } from './vendor-header';
import { OverviewTab } from './overview-tab';
import { UsersTab } from './users-tab';
import { ReadinessTab } from './readiness-tab';
import { BrandingTab } from './branding-tab';
import { VendorSubscriptionCard } from '../../../billing/components/vendor-subscription-card';
import { ImpersonationSessionsTab } from '../../../impersonation/components/impersonation-sessions-tab';
import { ActivityTab } from './activity-tab';
import { EmptyState } from '../../../../components/shared/empty-state';
import { ErrorState } from '../../../../components/shared/error-state';
import { PageHeader } from '../../../../components/shared/page-header';

export const VENDOR_TABS = ['overview', 'users', 'readiness', 'billing', 'branding', 'activity', 'impersonation'] as const;
export type VendorTab = (typeof VENDOR_TABS)[number];

const LABELS: Record<VendorTab, string> = {
  overview: 'Overview',
  users: 'Users',
  readiness: 'Readiness',
  billing: 'Billing',
  branding: 'Branding',
  activity: 'Activity',
  impersonation: 'Impersonation',
};

export function VendorDetailClient({ id }: { id: string }) {
  const [rawTab, setTab] = useQueryState('tab', parseAsString.withDefault('overview'));
  const tab: VendorTab = (VENDOR_TABS as readonly string[]).includes(rawTab) ? (rawTab as VendorTab) : 'overview';
  const { data: vendor, isLoading, error, refetch } = useVendor(id);

  if (isLoading) {
    return (
      <div className="space-y-6" aria-busy="true">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full max-w-xl" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  if (status === 404 || status === 400 || (!isLoading && !vendor && !error)) {
    return (
      <div className="space-y-6">
        <PageHeader title="Vendor not found" />
        <EmptyState
          title="Vendor not found"
          description="It may have been deleted, or the link is wrong."
          action={
            <Link href="/vendors" className="text-sm font-medium text-primary underline">
              Back to vendors
            </Link>
          }
        />
      </div>
    );
  }
  if (error || !vendor) {
    return (
      <div className="space-y-6">
        <ErrorState error={error} onRetry={() => void refetch()} />
      </div>
    );
  }

  const go = (t: VendorTab) => void setTab(t === 'overview' ? null : t);

  return (
    <div className="space-y-6">
      <VendorHeader vendor={vendor} />
      <Tabs value={tab} onValueChange={(v) => go(v as VendorTab)}>
        <div className="overflow-x-auto">
          <TabsList>
            {VENDOR_TABS.map((t) => (
              <TabsTrigger key={t} value={t}>
                {LABELS[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview" className="mt-4">
          <OverviewTab vendor={vendor} onOpenTab={go} />
        </TabsContent>
        <TabsContent value="users" className="mt-4">
          <UsersTab vendor={vendor} />
        </TabsContent>
        <TabsContent value="readiness" className="mt-4">
          <ReadinessTab vendor={vendor} onOpenTab={go} />
        </TabsContent>
        <TabsContent value="billing" className="mt-4">
          <VendorSubscriptionCard vendorId={vendor.id} vendorName={vendor.name} />
        </TabsContent>
        <TabsContent value="branding" className="mt-4">
          <BrandingTab vendor={vendor} />
        </TabsContent>
        <TabsContent value="activity" className="mt-4">
          <ActivityTab vendor={vendor} />
        </TabsContent>
        <TabsContent value="impersonation" className="mt-4">
          <ImpersonationSessionsTab vendorId={vendor.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
