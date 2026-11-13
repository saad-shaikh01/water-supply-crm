import { QUEUE_NAMES } from '@water-supply-crm/queue';

export interface CronMeta {
  jobId: string;
  queue: string;
  label: string;
  pattern: string;
  tz: string;
  /** Legacy `repeat` jobs carry no scheduler id; match them by job name instead. */
  legacyJobName?: string;
}

/** Static metadata mirroring the BullMQ schedulers registered at boot (see each service's onModuleInit). */
export const CRON_REGISTRY: CronMeta[] = [
  { jobId: 'daily-sheet-auto-generation', queue: QUEUE_NAMES.DAILY_SHEET_GENERATION, label: 'Daily sheet auto-generation', pattern: '5 0 * * *', tz: 'Asia/Karachi' },
  { jobId: 'fleet-notification-sweep', queue: QUEUE_NAMES.FLEET_NOTIFICATIONS, label: 'Fleet notification sweep', pattern: '15 0 * * *', tz: 'Asia/Karachi' },
  { jobId: 'warehouse-auto-refill', queue: QUEUE_NAMES.WAREHOUSE_AUTO_REFILL, label: 'Warehouse auto-refill', pattern: '15 0 * * *', tz: 'Asia/Karachi' },
  { jobId: 'crew-cash-stale-sync', queue: QUEUE_NAMES.CREW_CASH_SYNC, label: 'Crew cash stale sync', pattern: '30 0 * * *', tz: 'Asia/Karachi' },
  { jobId: 'tracking-daily-summary', queue: QUEUE_NAMES.TRACKING_HISTORY, label: 'Tracking daily summary', pattern: '0 1 * * *', tz: 'Asia/Karachi' },
  { jobId: 'tracking-breadcrumb-cleanup', queue: QUEUE_NAMES.TRACKING_HISTORY, label: 'Tracking breadcrumb cleanup', pattern: '0 2 * * *', tz: 'Asia/Karachi' },
  { jobId: 'whatsapp-account-health', queue: QUEUE_NAMES.WHATSAPP_HEALTH, label: 'WhatsApp account health check', pattern: '10 3 * * *', tz: 'Asia/Karachi' },
  // Legacy `repeat` API: shows up in getRepeatableJobs(), not getJobSchedulers().
  { jobId: 'payment-reminder-daily', queue: QUEUE_NAMES.PAYMENT_REMINDERS, label: 'Payment reminders (daily)', pattern: '0 5 * * *', tz: 'UTC', legacyJobName: 'send-payment-reminders' },
];
