'use client';

import { Suspense, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQueryState, parseAsString } from 'nuqs';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { DateRangePicker } from '../../../components/shared/date-range-picker';
import { VanFilter } from '../../../components/shared/filters/van-filter';
import { useAllVans } from '../../../features/vans/hooks/use-vans';
import { useFinancialAnalytics, useDeliveryAnalytics, useCustomerAnalytics, useStaffAnalytics } from '../../../features/analytics/hooks/use-analytics';

const OverviewTab = dynamic(
  () => import('../../../features/analytics/components/overview-tab').then((m) => m.OverviewTab),
  { loading: () => <div className="animate-pulse h-96 bg-muted rounded" /> }
);
const FinancialTab = dynamic(
  () => import('../../../features/analytics/components/financial-tab').then((m) => m.FinancialTab),
  { loading: () => <div className="animate-pulse h-96 bg-muted rounded" /> }
);
const DeliveriesTab = dynamic(
  () => import('../../../features/analytics/components/deliveries-tab').then((m) => m.DeliveriesTab),
  { loading: () => <div className="animate-pulse h-96 bg-muted rounded" /> }
);
const CustomersTab = dynamic(
  () => import('../../../features/analytics/components/customers-tab').then((m) => m.CustomersTab),
  { loading: () => <div className="animate-pulse h-96 bg-muted rounded" /> }
);
const StaffTab = dynamic(
  () => import('../../../features/analytics/components/staff-tab').then((m) => m.StaffTab),
  { loading: () => <div className="animate-pulse h-96 bg-muted rounded" /> }
);
const OperationsTab = dynamic(
  () => import('../../../features/analytics/components/operations-tab').then((m) => m.OperationsTab),
  { loading: () => <div className="animate-pulse h-96 bg-muted rounded" /> }
);
const ExportSection = dynamic(
  () => import('../../../features/analytics/components/export-section').then((m) => m.ExportSection),
  { loading: () => <div className="animate-pulse h-10 bg-muted rounded" /> }
);

function thisMonthRange() {
  const d = new Date();
  const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
  const to = d.toISOString().slice(0, 10);
  return { from, to };
}

function AnalyticsContent() {
  const [from, setFrom] = useQueryState('from', parseAsString.withDefault(''));
  const [to, setTo] = useQueryState('to', parseAsString.withDefault(''));
  const [vanId] = useQueryState('vanId', parseAsString.withDefault(''));
  const [activeTab, setActiveTab] = useState('overview');

  // Default to "This Month" on a fresh page load (no from/to in the URL yet).
  // Runs once on mount only — explicitly clearing the range afterwards (the
  // date picker's "Clear" button, for an "All Dates" view) is a deliberate
  // in-session choice and must not be silently reverted.
  useEffect(() => {
    if (!from && !to) {
      const range = thisMonthRange();
      setFrom(range.from);
      setTo(range.to);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: financialData } = useFinancialAnalytics(from, to, vanId);
  const { data: deliveriesData } = useDeliveryAnalytics(from, to, vanId);
  const { data: customersData } = useCustomerAnalytics(from, to, vanId);
  const { data: staffData } = useStaffAnalytics(from, to, vanId);

  // Confirms which van is being viewed right in the page header — the
  // dropdown alone is easy to miss once you're scrolled down a tab.
  const { data: vansData } = useAllVans();
  const selectedVanPlate = vanId ? (vansData?.data ?? []).find((v: any) => v.id === vanId)?.plateNumber : undefined;
  const headerDescription = selectedVanPlate
    ? `Showing data for Van ${selectedVanPlate} only`
    : 'In-depth insights into revenue, deliveries, customers and staff';

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description={headerDescription} />

      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 bg-card/30 p-3 sm:p-4 rounded-2xl border border-border">
        <div className="flex-1 min-w-0">
          <VanFilter />
        </div>
        <div className="flex-1 min-w-0">
          <DateRangePicker className="w-full sm:w-auto sm:min-w-64" />
        </div>
      </div>

      <ExportSection
        activeTab={activeTab}
        financialData={financialData}
        deliveriesData={deliveriesData}
        customersData={customersData}
        staffData={staffData}
        from={from}
        to={to}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-card/40 backdrop-blur-xl border border-white/10 rounded-2xl p-1 h-auto">
          <TabsTrigger value="overview" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold">
            Overview
          </TabsTrigger>
          <TabsTrigger value="financial" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold">
            Financial
          </TabsTrigger>
          <TabsTrigger value="deliveries" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold">
            Deliveries
          </TabsTrigger>
          <TabsTrigger value="customers" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold">
            Customers
          </TabsTrigger>
          <TabsTrigger value="staff" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold">
            Staff
          </TabsTrigger>
          <TabsTrigger value="operations" className="rounded-xl data-[state=active]:bg-primary data-[state=active]:text-primary-foreground font-semibold">
            Operations
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewTab from={from} to={to} vanId={vanId} onNavigate={setActiveTab} />
        </TabsContent>
        <TabsContent value="financial" className="mt-4">
          <FinancialTab from={from} to={to} vanId={vanId} />
        </TabsContent>
        <TabsContent value="deliveries" className="mt-4">
          <DeliveriesTab from={from} to={to} vanId={vanId} />
        </TabsContent>
        <TabsContent value="customers" className="mt-4">
          <CustomersTab from={from} to={to} vanId={vanId} />
        </TabsContent>
        <TabsContent value="staff" className="mt-4">
          <StaffTab from={from} to={to} vanId={vanId} />
        </TabsContent>
        <TabsContent value="operations" className="mt-4">
          <OperationsTab from={from} to={to} vanId={vanId} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <Suspense>
      <AnalyticsContent />
    </Suspense>
  );
}
