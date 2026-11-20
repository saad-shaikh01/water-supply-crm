import { createHmac, timingSafeEqual } from 'crypto';

/** Meta signs every webhook POST: `X-Hub-Signature-256: sha256=<hex HMAC-SHA256 of the raw body, keyed by the app secret>`. */
export function verifyMetaSignature(rawBody: Buffer | undefined, header: string | undefined, appSecret: string): boolean {
  if (!rawBody || !header || !appSecret) return false;
  const [scheme, signature] = header.split('=');
  if (scheme !== 'sha256' || !signature) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Constant-time string compare (for the webhook verify token). */
export function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface MetaMessageStatus {
  id: string; // wamid
  status: 'sent' | 'delivered' | 'read' | 'failed' | string;
  timestamp?: string; // unix seconds
  recipient_id?: string;
  errors?: { code?: number; title?: string; message?: string; error_data?: { details?: string } }[];
}

/** Flattens Meta's webhook envelope (`entry[].changes[].value.statuses[]`) into the status updates it carries. */
export function extractStatuses(body: any): MetaMessageStatus[] {
  const out: MetaMessageStatus[] = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      for (const s of change?.value?.statuses ?? []) {
        if (s?.id && s?.status) out.push(s);
      }
    }
  }
  return out;
}
