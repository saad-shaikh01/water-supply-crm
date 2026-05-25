'use client';

import { Suspense, useState } from 'react';
import dynamic from 'next/dynamic';
import { useQueryState, parseAsString } from 'nuqs';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { DateRangePicker } from '../../../components/shared/date-range-picker';
import { useFinancialAnalytics, useDeliveryAnalytics, useCustomerAnalytics, useStaffAnalytics } from '../../../features/analytics/hooks/use-analytics';

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
const ExportSection = dynamic(
  () => import('../../../features/analytics/components/export-section').then((m) => m.ExportSection),
  { loading: () => <div className="animate-pulse h-10 bg-muted rounded" /> }
);

function AnalyticsContent() {
  const [from] = useQueryState('from', parseAsString.withDefault(''));
  const [to] = useQueryState('to', parseAsString.withDefault(''));
  const [activeTab, setActiveTab] = useState('financial');

  const { data: financialData } = useFinancialAnalytics(from, to);
  const { data: deliveriesData } = useDeliveryAnalytics(from, to);
  const { data: customersData } = useCustomerAnalytics(from, to);
  const { data: staffData } = useStaffAnalytics(from, to);

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" description="In-depth insights into revenue, deliveries, customers and staff" />

      <DateRangePicker />

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
        </TabsList>

        <TabsContent value="financial" className="mt-4">
          <FinancialTab from={from} to={to} />
        </TabsContent>
        <TabsContent value="deliveries" className="mt-4">
          <DeliveriesTab from={from} to={to} />
        </TabsContent>
        <TabsContent value="customers" className="mt-4">
          <CustomersTab from={from} to={to} />
        </TabsContent>
        <TabsContent value="staff" className="mt-4">
          <StaffTab from={from} to={to} />
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
