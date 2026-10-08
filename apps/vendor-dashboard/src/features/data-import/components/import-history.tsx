'use client';

import Link from 'next/link';
import { useState } from 'react';
import { FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import {
  Button, Card, CardContent,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@water-supply-crm/ui';
import { DATA_IMPORT_PERMISSIONS } from '../constants';
import { useCan } from '../../authz/hooks/use-can';
import { useImportList } from '../hooks/use-data-import';
import { ImportStatusBadge, fileSize, isDraft } from './format';

/** History of every import for this vendor (support's first stop when something looks off). */
export function ImportHistory() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useImportList({ page, limit: 15 });
  const canUpload = useCan(DATA_IMPORT_PERMISSIONS.upload);

  if (isLoading) {
    return <div className="py-16 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />Loading…</div>;
  }

  if (!data || data.data.length === 0) {
    return (
      <Card className="rounded-3xl">
        <CardContent className="p-10 text-center space-y-4">
          <FileSpreadsheet className="h-12 w-12 mx-auto text-muted-foreground" />
          <div>
            <p className="text-lg font-bold">Bring your existing data in</p>
            <p className="text-sm text-muted-foreground max-w-lg mx-auto">
              Upload the Excel or CSV you already keep — customers with what they owe and how many bottles they hold, or their past deliveries and payments.
              You match the columns, preview everything, and only then import. Nothing is saved until you confirm.
            </p>
          </div>
          {canUpload && (
            <Button asChild className="rounded-full gap-2 px-6"><Link href="/dashboard/data-import/new"><Upload className="h-4 w-4" /> New import</Link></Button>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-3xl">
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>File</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Created</TableHead>
                <TableHead className="text-right">Skipped</TableHead>
                <TableHead className="text-right">Failed</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((b) => {
                const plan = b.summary?.plan;
                const p = b.summary?.progress;
                return (
                  <TableRow key={b.id}>
                    <TableCell className="whitespace-nowrap">{new Date(b.createdAt).toLocaleString()}</TableCell>
                    <TableCell>
                      <p className="font-medium">{b.sourceFileName}</p>
                      <p className="text-xs text-muted-foreground">{b.entity === 'TRANSACTION_HISTORY' ? 'Transaction history' : 'Customers & balances'} · {b.rowCount.toLocaleString()} rows · {fileSize(b.sourceFileSize)}</p>
                    </TableCell>
                    <TableCell>{b.createdByName ?? '—'}</TableCell>
                    <TableCell><ImportStatusBadge status={b.status} /></TableCell>
                    <TableCell className="text-right">{p ? p.created.toLocaleString() : plan ? `(${plan.create.toLocaleString()})` : '—'}</TableCell>
                    <TableCell className="text-right">{plan ? (plan.skipExisting + plan.skipInvalid).toLocaleString() : '—'}</TableCell>
                    <TableCell className="text-right">{p ? p.failed.toLocaleString() : '—'}</TableCell>
                    <TableCell className="text-right">
                      {b.status !== 'CANCELLED' && (
                        <Button asChild size="sm" variant="outline" className="rounded-full">
                          <Link href={`/dashboard/data-import/${b.id}`}>{isDraft(b.status) ? 'Continue' : 'Open'}</Link>
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {data.meta.totalPages > 1 && (
          <div className="flex items-center justify-between p-4 text-sm">
            <span className="text-muted-foreground">Page {page} of {data.meta.totalPages}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" className="rounded-full" disabled={page <= 1} onClick={() => setPage((x) => x - 1)}>Previous</Button>
              <Button size="sm" variant="outline" className="rounded-full" disabled={page >= data.meta.totalPages} onClick={() => setPage((x) => x + 1)}>Next</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
