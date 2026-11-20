import { JOB_NAMES } from '@water-supply-crm/queue';

/**
 * WhatsApp template/PDF jobs retry (the processor throws TransientSendError) only when the send provably never
 * reached WhatsApp — a dropped media upload, say. 15s → 30s → 60s gives a network blip time to clear.
 * (The queue-wide default is 3 attempts at 1s, far too short for that.)
 */
export const TRANSIENT_RETRY_OPTS = { attempts: 4, backoff: { type: 'exponential' as const, delay: 15_000 } };

/** Queue options for a job re-queued from the log page — same retry policy the job had when first queued. */
export function retryOptionsFor(jobName: string): typeof TRANSIENT_RETRY_OPTS | undefined {
  return jobName === JOB_NAMES.SEND_WHATSAPP_PDF || jobName === JOB_NAMES.SEND_WHATSAPP_TEMPLATE
    ? TRANSIENT_RETRY_OPTS
    : undefined;
}
