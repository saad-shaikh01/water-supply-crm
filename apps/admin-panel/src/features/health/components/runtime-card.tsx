import { Card, CardContent, CardHeader, CardTitle } from '@water-supply-crm/ui';
import { formatDateTime, formatUptime } from '../../observability/lib/format';
import type { SystemHealth } from '../api/health.api';

export function RuntimeCard({ health }: { health: SystemHealth }) {
  const { api, whatsapp } = health;
  const rows: [string, string][] = [
    ['Version', api?.version ?? '—'],
    ['Git SHA', api?.gitSha ? api.gitSha.slice(0, 8) : '—'],
    ['Environment', api?.nodeEnv ?? '—'],
    ['Uptime', formatUptime(api?.uptimeSeconds)],
    ['Started', formatDateTime(api?.startedAt)],
    ['Memory (RSS)', api ? `${api.memory.rssMb} MB` : '—'],
    ['Heap used', api ? `${api.memory.heapUsedMb} MB` : '—'],
  ];
  if (whatsapp) rows.push(['WhatsApp accounts', `${whatsapp.accountsTotal} (${whatsapp.accountsInvalid} invalid)`]);
  return (
    <Card data-testid="runtime-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Runtime</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
          {rows.map(([k, v]) => (
            <div key={k}>
              <dt className="text-xs text-muted-foreground">{k}</dt>
              <dd className="break-all font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
