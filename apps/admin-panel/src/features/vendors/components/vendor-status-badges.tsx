import { Badge } from '@water-supply-crm/ui';

export function VendorStatusBadge({ isActive }: { isActive?: boolean }) {
  const active = isActive !== false;
  return <Badge variant={active ? 'success' : 'destructive'}>{active ? 'Active' : 'Suspended'}</Badge>;
}

export function VendorLiveBadge({ live }: { live: boolean }) {
  return <Badge variant={live ? 'info' : 'warning'}>{live ? 'Live' : 'Setup'}</Badge>;
}
