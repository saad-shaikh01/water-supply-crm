import type { Invoice, Limits, SubscriptionStatus, Usage } from '../api/billing.api';

export const LIMIT_RESOURCES = [
  { key: 'customers', limitKey: 'maxCustomers', label: 'Customers' },
  { key: 'drivers', limitKey: 'maxDrivers', label: 'Drivers' },
  { key: 'vans', limitKey: 'maxVans', label: 'Vans' },
] as const;

export const limitText = (n: number | null | undefined) => (n === null || n === undefined ? 'Unlimited' : String(n));

export function exceedsLimits(usage: Usage, limits: Limits | null): boolean {
  if (!limits) return false;
  return LIMIT_RESOURCES.some((r) => {
    const l = limits[r.limitKey];
    return l !== null && usage[r.key] > l;
  });
}

/** Overdue is derived: an OPEN invoice whose due date has passed. */
export function isOverdue(inv: Pick<Invoice, 'status' | 'dueAt'>, now = new Date()): boolean {
  return inv.status === 'OPEN' && new Date(inv.dueAt).getTime() < now.getTime();
}

export const paidSum = (inv: Pick<Invoice, 'payments'>) => (inv.payments ?? []).reduce((s, p) => s + Number(p.amount), 0);

/** Remaining balance, rounded to cents (avoids 0.1+0.2 artefacts). */
export const remaining = (inv: Pick<Invoice, 'amount' | 'payments'>) =>
  Math.round((Number(inv.amount) - paidSum(inv)) * 100) / 100 || 0;

export const subscriptionVariant: Record<SubscriptionStatus, 'info' | 'success' | 'warning' | 'secondary'> = {
  TRIAL: 'info',
  ACTIVE: 'success',
  PAST_DUE: 'warning',
  CANCELLED: 'secondary',
};

export const money = (n: string | number, currency = 'PKR') =>
  `${currency} ${Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;

export const fmtDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { timeZone: 'Asia/Karachi', day: '2-digit', month: 'short', year: 'numeric' }) : '-';

/** `YYYY-MM-DD` (date input) -> ISO at noon PKT so the calendar day is stable in any timezone. */
export const dateInputToIso = (d: string) => `${d}T12:00:00+05:00`;

export const todayInput = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Karachi' });

/** Plan-limit / inactive-subscription errors (403) as friendly text, or null when it is some other error. */
export function limitErrorMessage(e: unknown): string | null {
  const d = (e as { response?: { status?: number; data?: Record<string, unknown> } })?.response;
  if (d?.status !== 403 || !d.data) return null;
  const data = d.data as { code?: string; resource?: string; limit?: number; used?: number; planName?: string; status?: string };
  if (data.code === 'PLAN_LIMIT_REACHED') {
    return `Plan limit reached: ${data.planName ?? 'the plan'} allows ${data.limit} ${String(data.resource ?? '').toLowerCase()}(s) and ${data.used} are in use. Upgrade the plan or add a limit override.`;
  }
  if (data.code === 'SUBSCRIPTION_INACTIVE') {
    return `Subscription is ${String(data.status ?? 'inactive').replace(/_/g, ' ').toLowerCase()}. Reactivate it or record a payment to continue.`;
  }
  return null;
}

/** Error text for billing mutations: limit/inactive errors get the friendly wording. */
export function billingErrorText(e: unknown, fallback: string, apiMsg: (e: unknown, f: string) => string): string {
  return limitErrorMessage(e) ?? apiMsg(e, fallback);
}
