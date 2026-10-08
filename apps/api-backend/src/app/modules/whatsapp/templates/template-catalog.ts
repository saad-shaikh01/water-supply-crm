import { CloudTemplateNames } from './cloud-template-names';

/**
 * The Meta message templates the app sends, as a vendor must create them on its OWN WhatsApp Business
 * Account (docs/features/multi-vendor-branding-and-whatsapp.md §5, template library). Bodies are the
 * text approved for Blue Ice (see cloud-api-templates.md) with the brand name replaced by `{{brand}}` —
 * rendered with the vendor's own name, so no vendor ever has to send another company's name.
 *
 * Positional variables ({{1}}, {{2}}, …) are what the code sends and must not be reordered.
 * Blue Ice's already-approved templates are NOT touched: its names/bodies stay exactly as they are.
 */
export type TemplateName = (typeof CloudTemplateNames)[keyof typeof CloudTemplateNames];

export type TemplateHeader = { type: 'NONE' } | { type: 'DOCUMENT' } | { type: 'IMAGE' } | { type: 'TEXT'; text: string };

export interface CatalogTemplate {
  /** Base name — what the code sends (Blue Ice uses it as-is; a suffixed brand sends `<name>_<suffix>`). */
  name: TemplateName;
  title: string;
  /** What triggers it. */
  usedFor: string;
  header: TemplateHeader;
  /** Body text with {{1}}… variables and a {{brand}} placeholder. */
  body: string;
  variables: string[];
  sample: string[];
  /** Needed before going live (core customer flows). */
  required: boolean;
  /** Internal (staff) recipients rather than customers. */
  internal?: boolean;
}

const N = CloudTemplateNames;

export const TEMPLATE_CATALOG: readonly CatalogTemplate[] = [
  {
    name: N.DELIVERY_RECEIPT, title: 'Delivery receipt (PDF)', usedFor: 'Sent with the PDF receipt after a delivery', required: true,
    header: { type: 'DOCUMENT' },
    body: `Assalamu Alaikum, {{1}},

Your Delivery Receipt is attached for your records.

Customer Code: {{2}}
Delivery Date: {{3}}
Delivery Status: Successfully Delivered

Thank you for choosing {{brand}}.

We appreciate your continued trust and business.

{{brand}}`,
    variables: ['Customer name', 'Customer code', 'Delivery date'], sample: ['Ahmed', 'L0042', '31 July 2026'],
  },
  {
    name: N.MONTHLY_STATEMENT, title: 'Monthly statement — balance due (PDF)', usedFor: 'Balance reminder with the statement attached', required: true,
    header: { type: 'DOCUMENT' },
    body: `Assalamu Alaikum, *{{1}}*,

Your monthly invoice is attached for your review.

Customer Code: *{{2}}*
Outstanding Balance: Rs. *{{3}}*

Kindly arrange payment at your earliest convenience.

Thank you for your continued trust in *{{brand}}*.`,
    variables: ['Customer name', 'Customer code', 'Outstanding balance'], sample: ['Ahmed', 'L0042', '1500.00'],
  },
  {
    name: N.MONTHLY_STATEMENT_ADVANCE, title: 'Monthly statement — advance credit (PDF)', usedFor: 'Statement for a customer in advance credit', required: true,
    header: { type: 'DOCUMENT' },
    body: `Assalamu Alaikum, {{1}}

Please find your {{2}} statement attached.

There is no outstanding balance on your account.
You have an advance credit of Rs. {{3}}.

Thank you for choosing {{brand}}.`,
    variables: ['Customer name', 'Month (e.g. June 2026)', 'Advance amount'], sample: ['Ahmed', 'June 2026', '500.00'],
  },
  {
    name: N.MONTHLY_STATEMENT_CLEAR, title: 'Monthly statement — all clear (PDF)', usedFor: 'Statement for a customer with zero balance', required: true,
    header: { type: 'DOCUMENT' },
    body: `Assalamu Alaikum, {{1}}

Please find your {{2}} statement attached.

There is no outstanding balance on your account — it is all clear.

Thank you for choosing {{brand}}.`,
    variables: ['Customer name', 'Month'], sample: ['Ahmed', 'June 2026'],
  },
  {
    name: N.MONTHLY_STATEMENT_NEUTRAL, title: 'Statement only (PDF)', usedFor: '"Statement only" send mode — no payment ask', required: false,
    header: { type: 'DOCUMENT' },
    body: `Assalamu Alaikum, {{1}}

Please find your {{2}} statement attached for your records.

Thank you for choosing {{brand}}.`,
    variables: ['Customer name', 'Month'], sample: ['Ahmed', 'September 2026'],
  },
  {
    name: N.PAYMENT_RECEIVED, title: 'Payment received', usedFor: 'When an online/manual payment request is approved', required: true,
    header: { type: 'TEXT', text: 'Payment Received' },
    body: `Assalamu Alaikum {{1}}!

Your payment has been received successfully.

💰 Amount Received: Rs. {{2}}
📊 Remaining Balance: Rs. {{3}}

Thank you for choosing {{brand}}. We appreciate your business!`,
    variables: ['Customer name', 'Amount received', 'Remaining balance'], sample: ['Ahmed', '2000', '200'],
  },
  {
    name: N.BALANCE_REMINDER, title: 'Balance reminder', usedFor: 'Text reminder without a statement', required: true,
    header: { type: 'NONE' },
    body: `Assalamu Alaikum, {{1}}

This is a friendly reminder about your outstanding balance of Rs. {{2}}.

We would appreciate your prompt payment.

Thank you for choosing {{brand}}.`,
    variables: ['Customer name', 'Balance'], sample: ['Ahmed', '1500.00'],
  },
  {
    name: N.PAYMENT_OVERDUE_WARNING, title: 'Overdue warning', usedFor: 'Follow-up after a statement when the balance is still pending', required: false,
    header: { type: 'NONE' },
    body: `Assalamu Alaikum, *{{1}}*

Customer Code: *{{2}}*

This is a reminder that your account has an outstanding balance of Rs. *{{3}}* which is still pending.

Invoice Amount: Rs. *{{4}}*
Payment Received: Rs. *{{5}}*
Total Current Balance Rs. *{{6}}*

To avoid any interruption to your scheduled deliveries, please clear the outstanding amount at your earliest convenience.

Thank you for your prompt attention and continued trust in *{{brand}}*.`,
    variables: ['Customer name', 'Customer code', 'Outstanding', 'Invoice amount', 'Payment received', 'Current total balance'],
    sample: ['Ahmed', 'L0042', '1200.00', '2000.00', '800.00', '1500.00'],
  },
  {
    name: N.BALANCE_CLEAR_ADVANCE, title: 'Balance clear — advance credit', usedFor: 'Reminder run, customer in advance credit', required: true,
    header: { type: 'NONE' },
    body: `Assalamu Alaikum, {{1}}

There is no outstanding balance on your account.
You have an advance credit of Rs. {{2}}.

Thank you for choosing {{brand}}.`,
    variables: ['Customer name', 'Advance amount'], sample: ['Ahmed', '500.00'],
  },
  {
    name: N.BALANCE_CLEAR, title: 'Balance clear', usedFor: 'Reminder run, customer with zero balance', required: true,
    header: { type: 'NONE' },
    body: `Assalamu Alaikum, {{1}}

Your account is all clear — there is no outstanding balance.

Thank you for choosing {{brand}}.`,
    variables: ['Customer name'], sample: ['Ahmed'],
  },
  {
    name: N.ORDER_APPROVED, title: 'Order approved', usedFor: 'Customer order approved', required: true,
    header: { type: 'NONE' },
    body: `Assalam o Alaikum {{1}}! ✅

Aapka order approve ho gaya:
🔵 Product: {{2}}
🫙 Quantity: {{3}}

Hum jald delivery karenge. Shukriya!`,
    variables: ['Customer name', 'Product', 'Quantity'], sample: ['Ahmed', '19L Bottle', '2'],
  },
  {
    name: N.ORDER_REJECTED, title: 'Order rejected', usedFor: 'Customer order rejected', required: true,
    header: { type: 'NONE' },
    body: `Assalam o Alaikum {{1}},

Afsos! Aapka order reject ho gaya:
🔵 Product: {{2}}
❌ Reason: {{3}}

Koi sawaal ho toh support se rabta karein.`,
    variables: ['Customer name', 'Product', 'Reason'], sample: ['Ahmed', '19L Bottle', 'Out of stock'],
  },
  {
    name: N.ORDER_PLANNED, title: 'Order planned', usedFor: 'Order scheduled for a delivery date', required: true,
    header: { type: 'NONE' },
    body: `Assalam o Alaikum {{1}}! 📅

Aapka order plan ho gaya:
🔵 Product: {{2}}
🫙 Quantity: {{3}}
📆 Delivery Date: {{4}}

Hum waqt par aayenge. Shukriya!`,
    variables: ['Customer name', 'Product', 'Quantity', 'Delivery date'], sample: ['Ahmed', '19L Bottle', '2', '08 July 2026'],
  },
  {
    name: N.ORDER_DISPATCHED, title: 'Order dispatched', usedFor: 'Order out for delivery today', required: true,
    header: { type: 'NONE' },
    body: `Assalam o Alaikum {{1}}! 🚚

Aapka order aaj deliver ho raha hai:
🔵 Product: {{2}}
🫙 Quantity: {{3}}

Driver raaste mein hai. Shukriya!`,
    variables: ['Customer name', 'Product', 'Quantity'], sample: ['Ahmed', '19L Bottle', '2'],
  },
  {
    name: N.TICKET_REPLIED, title: 'Support ticket replied', usedFor: 'Staff replied to a customer ticket', required: true,
    header: { type: 'NONE' },
    body: `Assalam o Alaikum {{1}}! 💬

Aapke ticket ka jawab aa gaya:
📋 Subject: {{2}}

Portal mein check karein. Shukriya!`,
    variables: ['Customer name', 'Ticket subject'], sample: ['Ahmed', 'Delivery late'],
  },
  {
    name: N.DELIVERY_CORRECTED, title: 'Delivery corrected (PDF)', usedFor: 'Sent before the re-issued receipt when a delivery entry is corrected', required: false,
    header: { type: 'NONE' },
    body: `Assalamu Alaikum, *{{1}}*,

Your previous delivery entry has been updated following a correction to the original record.

Please refer to the attached receipt as the latest and accurate version and disregard the previous one.

✅ *Corrected Details*:
🫙 Delivered: {{2}} bottles
🫙 Empty :  {{4}} bottles
💰 Cash Collected: Rs. {{3}}

Customer Code: *{{5}}*
Delivery Date: *{{6}}*
Status: Revised Delivery Record

We apologize for the oversight and appreciate your understanding.

Thank you for choosing {{brand}}. We value your business!`,
    variables: ['Customer name', 'Delivered qty', 'Cash collected', 'Empty received qty', 'Customer code', 'Delivery date'],
    sample: ['Ahmed', '2', '500', '2', 'L0042', '31 July 2026'],
  },
  {
    name: N.DELIVERY_UNSUCCESSFUL, title: 'Delivery unsuccessful', usedFor: 'Delivery attempt failed (no photo)', required: false,
    header: { type: 'NONE' },
    body: `Hi {{1}}, we visited today but your delivery ({{2}}) could not be completed.

Reason: {{3}}

We'll try again on your next scheduled delivery day.`,
    variables: ['Customer name', 'Customer code', 'Reason'], sample: ['Ahmed', 'L0042', 'You were not available at the time of delivery'],
  },
  {
    name: N.DELIVERY_UNSUCCESSFUL_PHOTO, title: 'Delivery unsuccessful (photo)', usedFor: 'Delivery attempt failed, driver attached a photo', required: false,
    header: { type: 'IMAGE' },
    body: `Hi {{1}}, we visited today but your delivery ({{2}}) could not be completed.

Reason: {{3}}

We'll try again on your next scheduled delivery day.`,
    variables: ['Customer name', 'Customer code', 'Reason'], sample: ['Ahmed', 'L0042', 'You were not available at the time of delivery'],
  },
  {
    name: N.FLEET_DOCUMENT_EXPIRY, title: 'Vehicle document expiry', usedFor: 'Nightly fleet sweep → alert recipients', required: false, internal: true,
    header: { type: 'NONE' },
    body: `Assalamu Alaikum,

⚠️ Vehicle *{{1}}* ka *{{2}}* {{3}}.

Expiry Date: *{{4}}*

Waqt par renew karwa lein taake koi rukawat na aaye.`,
    variables: ['Vehicle plate', 'Document type', 'Status phrase', 'Expiry date'], sample: ['KY-1874', 'Fitness Certificate', '5 din mein expire ho raha hai', '31 Dec 2026'],
  },
  {
    name: N.FLEET_MAINTENANCE_DUE, title: 'Vehicle maintenance due', usedFor: 'Nightly fleet sweep → alert recipients', required: false, internal: true,
    header: { type: 'NONE' },
    body: `Assalamu Alaikum,

🔧 Vehicle *{{1}}* ka *{{2}}* service {{3}}.

Kindly jald workshop schedule karwa lein.`,
    variables: ['Vehicle plate', 'Maintenance category', 'Status phrase'], sample: ['KY-1874', 'Engine Oil', '120 km se overdue hai'],
  },
  {
    name: N.PAYMENT_RECORDED, title: 'Payment recorded', usedFor: 'Manual payment recorded from the dashboard', required: true,
    header: { type: 'NONE' },
    body: `Assalamu Alaikum, *{{1}}*,

Customer Code: *{{2}}*

We are pleased to confirm that your payment of Rs.*{{3}}* has been received successfully.

Current Balance Rs. *{{4}}*

Thank you for your prompt payment and for choosing *{{brand}}*.

We truly appreciate your continued trust and support.`,
    variables: ['Customer name', 'Customer code', 'Amount paid', 'Current balance'], sample: ['Sharjeel', 'H1021', '1000', '1000'],
  },
  {
    name: N.SALARY_SLIP, title: 'Salary slip (PDF)', usedFor: 'Payroll → send salary slips to employees', required: false, internal: true,
    header: { type: 'DOCUMENT' },
    body: `Assalamu Alaikum, *{{1}}*,

Your salary slip for *{{2}}* is attached for your review.

Net payable: Rs. *{{3}}*

For any query, please contact the office.

Thank you for your hard work at *{{brand}}*.`,
    variables: ['Employee name', 'Period (e.g. 2026-09)', 'Net payable'], sample: ['Ali Raza', '2026-09', '45,000'],
  },
];
// NOTE: `payment_recorded_corrected` has no catalogue entry yet — its approved Blue Ice body is not recorded
// in cloud-api-templates.md. It is still sent by name; a vendor must create it by hand until it is added here.

export const CATALOG_BY_NAME: ReadonlyMap<string, CatalogTemplate> = new Map(TEMPLATE_CATALOG.map((t) => [t.name, t]));

/** The body a vendor submits to Meta: the catalogue text with the vendor's own brand name. */
export function renderTemplateBody(t: CatalogTemplate, brand: string): string {
  return t.body.split('{{brand}}').join(brand);
}

/** Name actually sent to Meta: the plain name, or `<name>_<suffix>` for a brand sharing a WABA. */
export function templateNameFor(base: string, suffix?: string | null): string {
  return suffix ? `${base}_${suffix}` : base;
}
