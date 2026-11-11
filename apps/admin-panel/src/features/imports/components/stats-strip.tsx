import { Card, CardContent } from '@water-supply-crm/ui';
import type { ImportStats } from '../api/imports.api';

const SHOWN = ['COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED', 'EXECUTING', 'QUEUED'] as const;

export function StatsStrip({ stats }: { stats?: ImportStats }) {
  const stuck = stats?.stuck ?? 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6" data-testid="imports-stats">
      {SHOWN.map((s) => (
        <Card key={s}>
          <CardContent className="p-4">
            <div className="text-xs uppercase text-muted-foreground">{s.replace(/_/g, ' ')} (7d)</div>
            <div className="text-2xl font-bold">{stats?.last7d?.[s] ?? 0}</div>
          </CardContent>
        </Card>
      ))}
      <Card className={stuck > 0 ? 'border-red-500/50 bg-red-500/10' : undefined} data-testid="imports-stuck" data-stuck={stuck}>
        <CardContent className="p-4">
          <div className={`text-xs uppercase ${stuck > 0 ? 'text-red-600' : 'text-muted-foreground'}`}>Stuck</div>
          <div className={`text-2xl font-bold ${stuck > 0 ? 'text-red-600' : ''}`}>{stuck}</div>
        </CardContent>
      </Card>
    </div>
  );
}
