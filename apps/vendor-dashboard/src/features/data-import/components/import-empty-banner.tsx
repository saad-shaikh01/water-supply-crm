'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { FileUp } from 'lucide-react';
import { Button, Card, CardContent } from '@water-supply-crm/ui';
import { customersApi } from '../../customers/api/customers.api';
import { useCan } from '../../authz/hooks/use-can';
import { DATA_IMPORT_PERMISSIONS } from '../constants';

/**
 * Discoverability for onboarding: a vendor with zero customers is pointed at Data Import from the
 * Customers page (instead of a separate onboarding wizard). Renders nothing once any customer exists.
 */
export function ImportEmptyBanner() {
  const canUpload = useCan(DATA_IMPORT_PERMISSIONS.upload);
  const { data } = useQuery({
    queryKey: ['data-imports', 'has-customers'],
    queryFn: () => customersApi.getAll({ page: 1, limit: 1 }).then((r) => r.data),
    enabled: canUpload,
    staleTime: 5 * 60_000,
  });

  const total: number | undefined = data?.meta?.total;
  if (!canUpload || total !== 0) return null;

  return (
    <Card className="rounded-3xl border-primary/30 bg-primary/5">
      <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex items-start gap-3">
          <FileUp className="h-6 w-6 text-primary mt-0.5 shrink-0" />
          <div>
            <p className="font-bold">Already have customers in Excel?</p>
            <p className="text-sm text-muted-foreground">Import them with their balances in a few minutes instead of adding them one by one.</p>
          </div>
        </div>
        <Button asChild className="rounded-full shrink-0"><Link href="/dashboard/data-import/new">Import from Excel</Link></Button>
      </CardContent>
    </Card>
  );
}
