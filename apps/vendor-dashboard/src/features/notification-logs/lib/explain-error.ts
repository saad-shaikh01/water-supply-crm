/**
 * Turns a log row's structured error (Meta error code or network cause) into a sentence a vendor can act on.
 * Rows written before failures were classified have no code — they fall back to the stored free text.
 */

const NETWORK_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'NETWORK', 'EPIPE',
  'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
]);

const META_CODES: Record<string, string> = {
  '132001': 'WhatsApp template not found in Meta (name or language mismatch, or not approved)',
  '132000': 'Message parameters do not match the approved template',
  '132005': 'Template text is too long after filling in the parameters',
  '132007': 'Template content violates a WhatsApp policy',
  '132012': 'A template parameter has an invalid format',
  '132015': 'Template is paused by Meta (low quality)',
  '132016': 'Template is disabled by Meta',
  '131026': 'This number cannot receive the message (not on WhatsApp, blocked the business, or outdated app)',
  '131047': 'The 24-hour reply window is closed',
  '131049': 'Meta limited delivery to this customer (too many business messages)',
  '131042': 'WhatsApp business payment method problem',
  '131056': 'Sending too fast to this number — slow down',
  '130429': 'Sending too fast — WhatsApp throughput limit reached',
  '131030': 'Number is not in the allowed list for this WhatsApp account',
  '133010': 'This phone number is not registered on WhatsApp',
  '190': 'WhatsApp access token is invalid or expired — contact your administrator',
  '401': 'WhatsApp access token is invalid or expired — contact your administrator',
  '10': 'WhatsApp permission missing — contact your administrator',
};

export interface ExplainedError {
  /** Short, plain-language reason for the table cell. */
  label: string;
  /** Everything technical, for the tooltip — raw text, code and stage. */
  detail: string;
  /** True when nothing reached WhatsApp, so a retry cannot message the customer twice. */
  retrySafe: boolean | null;
}

export function explainError(log: {
  lastError?: string | null;
  errorCode?: string | null;
  errorStage?: string | null;
  retryable?: boolean | null;
}): ExplainedError | null {
  const raw = log.lastError ?? '';
  if (!raw && !log.errorCode) return null;

  const code = log.errorCode ?? '';
  let label = raw;
  if (code === 'TIMEOUT') {
    label = 'WhatsApp did not answer in time — it may or may not have been delivered, check before retrying';
  } else if (NETWORK_CODES.has(code) || code.startsWith('UND_ERR')) {
    label = log.errorStage === 'upload'
      ? 'Network problem while uploading the PDF to WhatsApp'
      : 'Network problem reaching WhatsApp';
  } else if (META_CODES[code]) {
    label = META_CODES[code];
  }

  const detail = [raw, code && `code ${code}`, log.errorStage && `stage ${log.errorStage}`].filter(Boolean).join(' · ');
  return { label: label || raw, detail, retrySafe: log.retryable ?? null };
}

/** Delivery report Meta sent after accepting the message, as a badge. */
export function deliveryBadge(status: string | null | undefined): { text: string; tone: 'ok' | 'read' | 'bad' } | null {
  switch (status) {
    case 'READ': return { text: 'Read', tone: 'read' };
    case 'DELIVERED': return { text: 'Delivered', tone: 'ok' };
    case 'FAILED': return { text: 'Not delivered', tone: 'bad' };
    default: return null;
  }
}
