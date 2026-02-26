export const NOTIFICATION_EVENTS = {
  // Order lifecycle
  ORDER_SUBMITTED:   'order.submitted',
  ORDER_APPROVED:    'order.approved',
  ORDER_REJECTED:    'order.rejected',

  // Payment lifecycle
  PAYMENT_SUBMITTED: 'payment.submitted',
  PAYMENT_APPROVED:  'payment.approved',
  PAYMENT_REJECTED:  'payment.rejected',

  // Ticket lifecycle
  TICKET_CREATED:    'ticket.created',
  TICKET_REPLIED:    'ticket.replied',
  TICKET_RESOLVED:   'ticket.resolved',
} as const;

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[keyof typeof NOTIFICATION_EVENTS];
