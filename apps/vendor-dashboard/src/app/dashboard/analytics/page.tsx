'use client';

import { Suspense, useState } from 'react';
import { useQueryState, parseAsString } from 'nuqs';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { DateRangePicker } from '../../../components/shared/date-range-picker';
import { FinancialTab } from '../../../features/analytics/components/financial-tab';
import { DeliveriesTab } from '../../../features/analytics/components/deliveries-tab';
import { CustomersTab } from '../../../features/analytics/components/customers-tab';
import { StaffTab } from '../../../features/analytics/components/staff-tab';
import { ExportSection } from '../../../features/analytics/components/export-section';
import { useFinancialAnalytics, useDeliveryAnalytics, useCustomerAnalytics, useStaffAnalytics } from '../../../features/analytics/hooks/use-analytics';

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
