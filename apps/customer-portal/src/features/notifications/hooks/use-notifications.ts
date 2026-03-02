'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ordersApi } from '../../orders/api/orders.api';
import { paymentsApi } from '../../payments/api/payments.api';
import { ticketsApi } from '../../tickets/api/tickets.api';

const READ_STORAGE_KEY = 'customer-portal-notification-read';

export interface PortalNotification {
  id: string;
  source: 'PAYMENT' | 'ORDER' | 'TICKET';
  title: string;
  message: string;
  createdAt: string;
  href: string;
  isRead: boolean;
}

type NotificationRecord = Record<string, unknown>;

function readStoredIds() {
  if (typeof window === 'undefined') return [];

  try {
    const stored = window.localStorage.getItem(READ_STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

function toComparableTime(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function formatMoney(value: unknown) {
  const numeric = Number(value ?? 0);
  return `Rs ${numeric.toLocaleString()}`;
}

function buildPaymentNotifications(payments: NotificationRecord[]): PortalNotification[] {
  return payments.map((payment) => {
    const status = String(payment.status ?? 'PENDING');
    const method = String(payment.method ?? 'PAYMENT').replace(/_/g, ' ');
    const title =
      status === 'PAID' || status === 'APPROVED'
        ? 'Payment received'
        : status === 'REJECTED'
          ? 'Payment rejected'
          : status === 'EXPIRED'
            ? 'Payment expired'
            : 'Payment update';

    return {
      id: `payment:${payment.id}:${status}:${payment.createdAt ?? ''}`,
      source: 'PAYMENT',
      title,
      message: `${formatMoney(payment.amount)} via ${method}`,
      createdAt: String(payment.createdAt ?? ''),
      href: '/payments',
      isRead: false,
    };
  });
}

function buildOrderNotifications(orders: NotificationRecord[]): PortalNotification[] {
  return orders.map((order) => {
    const status = String(order.fulfillmentStatus ?? order.status ?? 'PENDING');
    const title =
      status === 'DELIVERED'
        ? 'Order delivered'
        : status === 'OUT_FOR_DELIVERY'
          ? 'Order is out for delivery'
          : status === 'PLANNED'
            ? 'Order scheduled'
            : status === 'REJECTED'
              ? 'Order rejected'
              : status === 'CANCELLED'
                ? 'Order cancelled'
                : status === 'APPROVED'
                  ? 'Order approved'
                  : 'Order update';
    const eventAt = String(order.deliveredAt ?? order.plannedDate ?? order.createdAt ?? '');
    const product = order.product as NotificationRecord | undefined;
    const productName = typeof product?.name === 'string' ? product.name : 'Product';

    return {
      id: `order:${order.id}:${status}:${eventAt}`,
      source: 'ORDER',
      title,
      message: `${productName} x ${Number(order.quantity ?? 0)}`,
      createdAt: eventAt,
      href: '/orders',
      isRead: false,
    };
  });
}

function buildTicketNotifications(tickets: NotificationRecord[]): PortalNotification[] {
  return tickets.map((ticket) => {
    const hasVendorReply = Boolean(ticket.vendorReply);
    const status = String(ticket.status ?? 'OPEN');
    const eventAt = String(ticket.resolvedAt ?? ticket.createdAt ?? '');

    return {
      id: `ticket:${ticket.id}:${status}:${hasVendorReply ? 'reply' : 'status'}:${eventAt}`,
      source: 'TICKET',
      title: hasVendorReply ? 'Vendor replied to your ticket' : 'Support ticket update',
      message: String(ticket.subject ?? 'Support ticket'),
      createdAt: eventAt,
      href: '/support',
      isRead: false,
    };
  });
}

export function useNotifications() {
  const [readIds, setReadIds] = useState<string[]>([]);

  useEffect(() => {
    setReadIds(readStoredIds());
  }, []);

  const persistReadIds = useCallback((nextIds: string[]) => {
    setReadIds(nextIds);
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(READ_STORAGE_KEY, JSON.stringify(nextIds));
  }, []);

  const query = useQuery({
    queryKey: ['portal-notifications'],
    queryFn: async () => {
      const [paymentsResponse, ordersResponse, ticketsResponse] = await Promise.all([
        paymentsApi.getPaymentHistory({ page: 1, limit: 6 }).then((response) => response.data),
        ordersApi.getAll({ page: 1, limit: 6 }).then((response) => response.data),
        ticketsApi.getAll({ page: 1, limit: 6 }).then((response) => response.data),
      ]);

      const payments = buildPaymentNotifications((paymentsResponse as { data?: NotificationRecord[] })?.data ?? []);
      const orders = buildOrderNotifications((ordersResponse as { data?: NotificationRecord[] })?.data ?? []);
      const tickets = buildTicketNotifications((ticketsResponse as { data?: NotificationRecord[] })?.data ?? []);

      return [...payments, ...orders, ...tickets]
        .sort((left, right) => toComparableTime(right.createdAt) - toComparableTime(left.createdAt))
        .slice(0, 12);
    },
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const notifications = useMemo(
    () =>
      (query.data ?? []).map((notification) => ({
        ...notification,
        isRead: readIds.includes(notification.id),
      })),
    [query.data, readIds]
  );

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.isRead).length,
    [notifications]
  );

  const markAsRead = useCallback(
    (id: string) => {
      if (readIds.includes(id)) return;
      persistReadIds([...readIds, id]);
    },
    [persistReadIds, readIds]
  );

  const markAllAsRead = useCallback(() => {
    const nextIds = Array.from(new Set([...readIds, ...notifications.map((notification) => notification.id)]));
    persistReadIds(nextIds);
  }, [notifications, persistReadIds, readIds]);

  return {
    ...query,
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    supportsServerReadActions: false,
  };
}
