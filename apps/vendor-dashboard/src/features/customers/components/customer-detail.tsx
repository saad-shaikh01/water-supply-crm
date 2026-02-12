'use client';

import { Tabs, TabsContent, TabsList, TabsTrigger, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@water-supply-crm/ui';
import { useCustomer } from '../hooks/use-customers';
import { PageHeader } from '../../../components/shared/page-header';
import { TransactionList } from '../../transactions/components/transaction-list';
import { NuqsAdapter } from 'nuqs/adapters/next/app';

interface CustomerDetailProps {
  customerId: string;
}

export function CustomerDetail({ customerId }: CustomerDetailProps) {
  const { data, isLoading } = useCustomer(customerId);

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const customer = (data ?? {}) as Record<string, unknown>;

  return (
    <NuqsAdapter>
      <PageHeader
        title={String(customer.name ?? 'Customer')}
        description={String(customer.phone ?? '')}
      />
      <div className="grid gap-4 md:grid-cols-3 mb-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Wallet Balance</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${Number(customer.walletBalance ?? 0).toFixed(2)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Route</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-lg font-semibold">{(customer.route as { name?: string } | undefined)?.name ?? '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Address</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm">{String(customer.address ?? '—')}</p>
          </CardContent>
        </Card>
      </div>
      <Tabs defaultValue="transactions">
        <TabsList>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="info">Info</TabsTrigger>
        </TabsList>
        <TabsContent value="transactions">
          <TransactionList customerId={customerId} />
        </TabsContent>
        <TabsContent value="info">
          <Card>
            <CardContent className="pt-6 space-y-2">
              <p><span className="font-medium">Name:</span> {String(customer.name ?? '—')}</p>
              <p><span className="font-medium">Phone:</span> {String(customer.phone ?? '—')}</p>
              <p><span className="font-medium">Address:</span> {String(customer.address ?? '—')}</p>
              <p><span className="font-medium">Bottle Count:</span> {String(customer.bottleCount ?? 0)}</p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </NuqsAdapter>
  );
}
