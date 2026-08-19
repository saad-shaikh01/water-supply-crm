/**
 * Meta-approved WhatsApp template names — must match exactly what's submitted
 * in Meta Business Manager (see cloud-api-templates.md). Centralized here so a
 * rename during Meta's review is a one-line fix instead of a grep across services.
 */
export const CloudTemplateNames = {
  DELIVERY_RECEIPT: 'delivery_receipt',
  MONTHLY_STATEMENT: 'monthly_statement',
  MONTHLY_STATEMENT_ADVANCE: 'monthly_statement_advance',
  MONTHLY_STATEMENT_CLEAR: 'monthly_statement_clear',
  BALANCE_REMINDER: 'balance_reminder',
  BALANCE_CLEAR_ADVANCE: 'balance_clear_advance',
  BALANCE_CLEAR: 'balance_clear',
  PAYMENT_RECEIVED: 'payment_received',
  ORDER_APPROVED: 'order_approved',
  ORDER_REJECTED: 'order_rejected',
  ORDER_PLANNED: 'order_planned',
  ORDER_DISPATCHED: 'order_dispatched',
  TICKET_REPLIED: 'ticket_replied',
  DELIVERY_UNSUCCESSFUL: 'delivery_unsuccessful',
  DELIVERY_UNSUCCESSFUL_PHOTO: 'delivery_unsuccessful_photo',
} as const;
