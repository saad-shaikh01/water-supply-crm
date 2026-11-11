export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** "5 min ago" / "in 3 h". `now` is injectable for tests. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const diff = Math.round((t - now) / 1000);
  const abs = Math.abs(diff);
  if (abs < 5) return 'just now';
  let text: string;
  if (abs < 45) text = `${abs}s`;
  else if (abs < 45 * 60) text = `${Math.round(abs / 60)} min`;
  else if (abs < 36 * 3600) text = `${Math.round(abs / 3600)} h`;
  else text = `${Math.round(abs / 86400)} d`;
  return diff < 0 ? `${text} ago` : `in ${text}`;
}

export function formatUptime(seconds: number | null | undefined): string {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s < 0) return '—';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(s % 60)}s`;
}

export function formatBytes(n: number | null | undefined): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${(v / 1024 / 1024).toFixed(1)} MB`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s.trim());

/** Human text for the simple cron patterns used by the platform schedulers; falls back to the raw pattern. */
export function describeCron(pattern: string | null | undefined): string {
  if (!pattern) return '—';
  const p = pattern.trim().split(/\s+/);
  if (p.length === 5) {
    const [min, hour, dom, mon, dow] = p;
    const every = /^\*\/(\d+)$/.exec(min);
    if (every && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Every ${every[1]} minutes`;
    if (/^\d+$/.test(min) && /^\d+$/.test(hour) && dom === '*' && mon === '*' && dow === '*') {
      return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
    }
    if (/^\d+$/.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') return `Hourly at :${min.padStart(2, '0')}`;
  }
  return pattern;
}
