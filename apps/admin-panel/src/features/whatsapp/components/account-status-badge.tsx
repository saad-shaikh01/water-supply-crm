import { Badge } from '@water-supply-crm/ui';
import type { WhatsAppStatus } from '../api/whatsapp.api';

const MAP: Record<WhatsAppStatus, { variant: 'success' | 'destructive' | 'warning' | 'secondary'; label: string }> = {
  READY: { variant: 'success', label: 'Ready' },
  TOKEN_INVALID: { variant: 'destructive', label: 'Credentials invalid' },
  SUSPENDED: { variant: 'warning', label: 'Suspended' },
  NOT_CONFIGURED: { variant: 'secondary', label: 'Not configured' },
};

export function AccountStatusBadge({ status }: { status: WhatsAppStatus }) {
  const m = MAP[status] ?? { variant: 'secondary' as const, label: status };
  return (
    <Badge variant={m.variant} data-status={status}>
      {m.label}
    </Badge>
  );
}
