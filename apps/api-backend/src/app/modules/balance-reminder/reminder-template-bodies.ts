import { CloudTemplateNames } from '../whatsapp/templates/cloud-template-names';

/**
 * LOCAL COPY of the approved Meta template bodies, used only to render the
 * "view message" preview. Meta holds the source of truth — if a template is
 * edited/re-approved there, update it here too (see
 * whatsapp/templates/cloud-api-templates.md). Sending never reads this file.
 */
const BODIES: Record<string, string> = {
  [CloudTemplateNames.MONTHLY_STATEMENT]:
    'Assalamu Alaikum, *{{1}}*,\n\nYour monthly invoice is attached for your review.\n\nCustomer Code: *{{2}}*\nOutstanding Balance: Rs. *{{3}}*\n\nKindly arrange payment at your earliest convenience.\n\nThank you for your continued trust in *Blue Ice*.',
  [CloudTemplateNames.MONTHLY_STATEMENT_ADVANCE]:
    'Assalamu Alaikum, {{1}}\n\nPlease find your {{2}} statement attached.\n\nThere is no outstanding balance on your account.\nYou have an advance credit of Rs. {{3}}.\n\nThank you for choosing Blue Ice.',
  [CloudTemplateNames.MONTHLY_STATEMENT_CLEAR]:
    'Assalamu Alaikum, {{1}}\n\nPlease find your {{2}} statement attached.\n\nThere is no outstanding balance on your account — it is all clear.\n\nThank you for choosing Blue Ice.',
  [CloudTemplateNames.MONTHLY_STATEMENT_NEUTRAL]:
    'Assalamu Alaikum, {{1}}\n\nPlease find your {{2}} statement attached for your records.\n\nThank you for choosing Blue Ice.',
  [CloudTemplateNames.BALANCE_REMINDER]:
    'Assalamu Alaikum, {{1}}\n\nThis is a friendly reminder about your outstanding balance of Rs. {{2}}.\n\nWe would appreciate your prompt payment.\n\nThank you for choosing Blue Ice.',
  [CloudTemplateNames.BALANCE_CLEAR_ADVANCE]:
    'Assalamu Alaikum, {{1}}\n\nThere is no outstanding balance on your account.\nYou have an advance credit of Rs. {{2}}.\n\nThank you for choosing Blue Ice.',
  [CloudTemplateNames.BALANCE_CLEAR]:
    'Assalamu Alaikum, {{1}}\n\nYour account is all clear — there is no outstanding balance.\n\nThank you for choosing Blue Ice.',
  [CloudTemplateNames.PAYMENT_OVERDUE_WARNING]:
    'Assalamu Alaikum, *{{1}}*\n\nCustomer Code: *{{2}}*\n\nThis is a reminder that your account has an outstanding balance of Rs. *{{3}}* which is still pending.\n\nInvoice Amount: Rs. *{{4}}*\nPayment Received: Rs. *{{5}}*\nTotal Current Balance Rs. *{{6}}*\n\nTo avoid any interruption to your scheduled deliveries, please clear the outstanding amount at your earliest convenience.\n\nThank you for your prompt attention and continued trust in *Blue Ice*.',
};

/** Fill `{{n}}` placeholders; null when we hold no local copy of that template. */
export function renderTemplateBody(templateName: string, params: string[]): string | null {
  const body = BODIES[templateName];
  if (!body) return null;
  return body.replace(/\{\{(\d+)\}\}/g, (_, n) => params[Number(n) - 1] ?? '');
}
