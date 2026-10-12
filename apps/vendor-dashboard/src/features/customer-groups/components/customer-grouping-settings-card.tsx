'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '@water-supply-crm/ui';
import { useCan } from '../../authz/hooks/use-can';
import { customerGroupsApi } from '../api/customer-groups.api';
import { useGroupingEnabled, useSetGroupingEnabled } from '../hooks/use-customer-groups';

/**
 * On/off switch for optional customer grouping (Group -> Sub-group). Vendor admins flip it for
 * their own vendor; a super admin passes `vendorId` to flip it for the vendor they are editing.
 * Turning it off only hides the feature, nothing is deleted.
 */
export function CustomerGroupingSettingsCard({ vendorId }: { vendorId?: string }) {
  const canUpdate = useCan('company_profile:update');
  const qc = useQueryClient();

  const own = useGroupingEnabled();
  const setOwn = useSetGroupingEnabled();

  const other = useQuery({
    queryKey: ['customer-groups', 'vendor-settings', vendorId],
    queryFn: () => customerGroupsApi.getVendorSettings(vendorId as string).then((r) => r.data),
    enabled: !!vendorId,
  });
  const setOther = useMutation({
    mutationFn: (enabled: boolean) => customerGroupsApi.setVendorSettings(vendorId as string, enabled).then((r) => r.data),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['customer-groups'] });
      toast.success(res.enabled ? 'Customer grouping enabled' : 'Customer grouping disabled (groups are kept)');
    },
    onError: () => toast.error('Could not update the grouping setting'),
  });

  const enabled = vendorId ? other.data?.enabled ?? false : own.enabled;
  const isLoading = vendorId ? other.isLoading : own.isLoading;
  const isPending = vendorId ? setOther.isPending : setOwn.isPending;
  const toggle = (next: boolean) => (vendorId ? setOther.mutate(next) : setOwn.mutate(next));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" /> Customer Grouping
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          Organise customers into groups (and optional sub-groups), and filter the customer list by them. Off by
          default; turning it off later hides the feature but keeps your groups and assignments.
        </p>
        <label className="flex items-center gap-2 shrink-0 text-sm font-semibold">
          {(isLoading || isPending) && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={enabled}
            disabled={!canUpdate || isLoading || isPending}
            onChange={(e) => toggle(e.target.checked)}
          />
          {enabled ? 'Enabled' : 'Disabled'}
        </label>
      </CardContent>
    </Card>
  );
}
