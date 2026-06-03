'use client';

import { useState, useMemo } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Badge,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
  Label,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@water-supply-crm/ui';
import { PageHeader } from '../../../components/shared/page-header';
import { useAllVans } from '../../vans/hooks/use-vans';
import { useQuery } from '@tanstack/react-query';
import { productsApi } from '../../products/api/products.api';
import {
  usePreviewBulkPricing,
  useBulkUpdatePricing,
  useBulkUpdateJobStatus,
} from '../hooks/use-pricing';
import type { BulkPriceFilters, BulkPriceActionType, PricingCustomerRow } from '../types';

const ACTION_OPTIONS: { value: BulkPriceActionType; label: string; symbol: string }[] = [
  { value: 'SET', label: 'Set exact price', symbol: '₨' },
  { value: 'FLAT_INCREASE', label: 'Flat increase', symbol: '+₨' },
  { value: 'PERCENTAGE_INCREASE', label: 'Percentage increase', symbol: '+%' },
];

export function PricingPage() {
  const { data: vansData } = useAllVans();
  const { data: productsData } = useQuery({
    queryKey: ['products', 'all-active'],
    queryFn: () => productsApi.getAll({ limit: 100, isActive: true }).then((r) => r.data),
  });

  const vans = (vansData?.data as Array<{ id: string; plateNumber: string }>) ?? [];
  const products = (productsData?.data as Array<{ id: string; name: string }>) ?? [];

  const [productId, setProductId] = useState('');
  const [priceFrom, setPriceFrom] = useState('');
  const [priceTo, setPriceTo] = useState('');
  const [area, setArea] = useState('');
  const [vanId, setVanId] = useState('');
  const [billingType, setBillingType] = useState('');

  const [actionType, setActionType] = useState<BulkPriceActionType>('SET');
  const [actionValue, setActionValue] = useState('');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);

  const previewMutation = usePreviewBulkPricing();
  const updateMutation = useBulkUpdatePricing();
  const { data: jobStatus } = useBulkUpdateJobStatus(activeJobId);

  const previewResult = previewMutation.data;

  const filters: BulkPriceFilters = useMemo(
    () => ({
      productId,
      priceFrom: priceFrom ? parseFloat(priceFrom) : undefined,
      priceTo: priceTo ? parseFloat(priceTo) : undefined,
      area: area || undefined,
      vanId: vanId || undefined,
      billingType: (billingType as 'MONTHLY' | 'CASH') || undefined,
    }),
    [productId, priceFrom, priceTo, area, vanId, billingType],
  );

  const handlePreview = () => {
    if (!productId) return;
    previewMutation.mutate(filters);
  };

  const computedNewPrice = useMemo(() => {
    if (!previewResult?.customers.length || !actionValue) return null;
    const sample = previewResult.customers[0];
    const val = parseFloat(actionValue);
    if (isNaN(val) || val < 0) return null;
    switch (actionType) {
      case 'SET': return val;
      case 'FLAT_INCREASE': return sample.currentPrice + val;
      case 'PERCENTAGE_INCREASE': return Math.round(sample.currentPrice * (1 + val / 100));
    }
  }, [previewResult, actionType, actionValue]);

  const handleConfirmedUpdate = () => {
    if (!productId || !actionValue) return;
    updateMutation.mutate(
      { filters, action: { type: actionType, value: parseFloat(actionValue) } },
      {
        onSuccess: (result) => {
          if (result.jobId) {
            setActiveJobId(result.jobId);
          }
          previewMutation.reset();
          setActionValue('');
        },
      },
    );
    setConfirmOpen(false);
  };

  const count = previewResult?.count ?? 0;
  const customers: PricingCustomerRow[] = previewResult?.customers ?? [];
  const canUpdate = count > 0 && actionValue !== '' && parseFloat(actionValue) >= 0 && productId;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bulk Price Update"
        description="Filter customers by product, price range, area, or van, then apply a bulk price change."
      />

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label>Product *</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select product" />
                </SelectTrigger>
                <SelectContent>
                  {products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Current Price From (₨)</Label>
              <Input
                type="number"
                min={0}
                placeholder="e.g. 100"
                value={priceFrom}
                onChange={(e) => setPriceFrom(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Current Price To (₨)</Label>
              <Input
                type="number"
                min={0}
                placeholder="e.g. 150"
                value={priceTo}
                onChange={(e) => setPriceTo(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Area</Label>
              <Input
                placeholder="e.g. Johar, Gulshan"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Van / Route</Label>
              <Select value={vanId} onValueChange={setVanId}>
                <SelectTrigger>
                  <SelectValue placeholder="All vans" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All vans</SelectItem>
                  {vans.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.plateNumber}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Billing Type</Label>
              <Select value={billingType} onValueChange={setBillingType}>
                <SelectTrigger>
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All types</SelectItem>
                  <SelectItem value="MONTHLY">Monthly</SelectItem>
                  <SelectItem value="CASH">Cash</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            onClick={handlePreview}
            disabled={!productId || previewMutation.isPending}
            className="mt-2"
          >
            {previewMutation.isPending ? 'Loading...' : 'Preview Customers'}
          </Button>
        </CardContent>
      </Card>

      {/* Preview Results */}
      {previewMutation.isSuccess && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Preview Results</CardTitle>
            <Badge variant={count > 0 ? 'default' : 'secondary'}>
              {count} customer{count !== 1 ? 's' : ''} match
            </Badge>
          </CardHeader>
          <CardContent>
            {count === 0 ? (
              <p className="text-muted-foreground text-sm text-center py-8">
                No customers match these filters
              </p>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Area / Address</TableHead>
                      <TableHead className="text-right">Current Price</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {customers.slice(0, 50).map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell className="text-muted-foreground text-sm truncate max-w-[200px]">
                          {c.area}
                        </TableCell>
                        <TableCell className="text-right">₨{c.currentPrice}</TableCell>
                      </TableRow>
                    ))}
                    {count > 50 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-muted-foreground text-sm py-3">
                          ... and {count - 50} more customers
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Job Progress */}
      {activeJobId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Update in Progress</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {jobStatus?.state === 'completed' ? (
              <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                ✅ {jobStatus.updatedCount} customer{jobStatus.updatedCount !== 1 ? 's' : ''} updated successfully
              </p>
            ) : jobStatus?.state === 'failed' ? (
              <p className="text-sm font-medium text-destructive">
                ❌ Update failed. Please try again.
              </p>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  Updating {jobStatus?.totalCustomers ?? 0} customers... {jobStatus?.progress ?? 0}%
                </p>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-2 bg-primary rounded-full transition-all"
                    style={{ width: `${jobStatus?.progress ?? 0}%` }}
                  />
                </div>
              </>
            )}

            {(jobStatus?.state === 'completed' || jobStatus?.state === 'failed') && (
              <Button onClick={() => setActiveJobId(null)}>Done</Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Action */}
      {count > 0 && !activeJobId && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Action</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-3">
              {ACTION_OPTIONS.map((opt) => (
                <label key={opt.value} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="actionType"
                    value={opt.value}
                    checked={actionType === opt.value}
                    onChange={() => setActionType(opt.value)}
                    className="accent-primary"
                  />
                  <span className="text-sm font-medium">{opt.label}</span>
                </label>
              ))}
            </div>

            <div className="flex items-center gap-3 max-w-xs">
              <span className="text-muted-foreground text-sm w-12">
                {ACTION_OPTIONS.find((o) => o.value === actionType)?.symbol}
              </span>
              <Input
                type="number"
                min={0}
                placeholder="Value"
                value={actionValue}
                onChange={(e) => setActionValue(e.target.value)}
                className="max-w-[140px]"
              />
            </div>

            {computedNewPrice !== null && customers[0] && (
              <p className="text-sm text-muted-foreground">
                New price preview:{' '}
                <span className="font-semibold text-foreground">
                  ₨{customers[0].currentPrice} → ₨{computedNewPrice}
                </span>{' '}
                (for {count} customer{count !== 1 ? 's' : ''})
              </p>
            )}

            <Button
              variant="destructive"
              disabled={!canUpdate || updateMutation.isPending}
              onClick={() => setConfirmOpen(true)}
            >
              {updateMutation.isPending
                ? 'Updating...'
                : `Update ${count} Customer${count !== 1 ? 's' : ''}`}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Bulk Price Update</DialogTitle>
            <DialogDescription>
              You are about to update pricing for{' '}
              <strong>{count} customer{count !== 1 ? 's' : ''}</strong>.
              This cannot be undone. Are you sure?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmedUpdate}>
              Confirm Update
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
