import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { PrismaService } from '@water-supply-crm/database';
import { paginate } from '../../common/helpers/paginate';
import { normalizePhone } from '../whatsapp/phone.util';
import { NotificationLogQueryDto } from './dto/notification-log-query.dto';
import { BulkRetryDto } from './dto/bulk-retry.dto';
import { retryOptionsFor } from './notification-job-options';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationChannel, NotificationType } from '@prisma/client';

// Cap on delivery items resolved for a van/sheet filter — keeps the `IN (...)` list sane.
const MAX_ITEM_IDS = 20000;
// One "Retry all failed" pass handles at most this many rows (run again for more), spaced this far apart.
const BULK_RETRY_MAX = 300;
const BULK_RETRY_STAGGER_MS = 600;

@Injectable()
export class NotificationLogService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly notificationQueue: Queue,
    private readonly settings: NotificationSettingsService,
  ) {}

  async findLogs(vendorId: string, query: NotificationLogQueryDto) {
    const { page = 1, limit = 20 } = query;
    const where = await this.buildWhere(vendorId, query);

    const [data, total] = await Promise.all([
      this.prisma.notificationLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notificationLog.count({ where }),
    ]);

    const enriched = await this.attachRetryOutcome(await this.attachCustomerAndSheet(vendorId, data));
    return paginate(enriched, total, page, limit);
  }

  /**
   * For rows that were retried: what the retry turned into, so the user does not have to hunt for the new row.
   * `null` while the retry is still queued / backing off (a row is only written once it succeeds or gives up).
   */
  private async attachRetryOutcome<T extends { id: string; retriedAt: Date | null }>(logs: T[]) {
    const retriedIds = logs.filter((l) => l.retriedAt).map((l) => l.id);
    const outcomes = retriedIds.length
      ? await this.prisma.notificationLog.findMany({
          where: { retryOfId: { in: retriedIds } },
          orderBy: { createdAt: 'desc' },
          select: { retryOfId: true, status: true, createdAt: true, lastError: true, deliveryStatus: true },
        })
      : [];
    const latest = new Map<string, (typeof outcomes)[number]>();
    for (const o of outcomes) if (o.retryOfId && !latest.has(o.retryOfId)) latest.set(o.retryOfId, o);

    return logs.map((log) => {
      const o = latest.get(log.id);
      return {
        ...log,
        retryOutcome: o
          ? { status: o.status, at: o.createdAt, error: o.lastError, deliveryStatus: o.deliveryStatus }
          : null,
      };
    });
  }

  /**
   * Counts for the current filters, deliberately ignoring the status filter so the
   * Sent / Failed / Skipped cards always show the full split for the selection.
   */
  async summary(vendorId: string, query: NotificationLogQueryDto) {
    const where = await this.buildWhere(vendorId, query, { ignoreStatus: true });

    const [byStatus, byDelivery, byType, disabled, notDelivered, otherErrors] = await Promise.all([
      this.prisma.notificationLog.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.notificationLog.groupBy({
        by: ['deliveryStatus'],
        where: { AND: [where, { status: 'SENT', channel: 'WHATSAPP' }] },
        _count: { _all: true },
      }),
      this.prisma.notificationLog.groupBy({ by: ['eventType'], where, _count: { _all: true } }),
      this.prisma.notificationLog.count({ where: { AND: [where, this.errorClause('DISABLED')] } }),
      this.prisma.notificationLog.count({ where: { AND: [where, this.errorClause('NOT_DELIVERED')] } }),
      this.prisma.notificationLog.count({ where: { AND: [where, this.errorClause('API_ERROR')] } }),
    ]);

    const statusCounts: Record<string, number> = { SENT: 0, FAILED: 0, SKIPPED: 0 };
    for (const row of byStatus) statusCounts[row.status] = row._count._all;

    // Of the SENT rows: what Meta later reported. PENDING = accepted by Meta, no delivery report (yet).
    const deliveryCounts: Record<string, number> = { DELIVERED: 0, READ: 0, FAILED: 0, PENDING: 0 };
    for (const row of byDelivery) deliveryCounts[row.deliveryStatus ?? 'PENDING'] = row._count._all;

    return {
      total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
      byStatus: statusCounts,
      byDelivery: deliveryCounts,
      byEventType: byType.map((r) => ({ eventType: r.eventType, count: r._count._all })),
      byErrorCategory: { DISABLED: disabled, NOT_DELIVERED: notDelivered, API_ERROR: otherErrors },
    };
  }

  /** Re-queues a failed WhatsApp send from the job data captured when it failed. */
  async retry(vendorId: string, id: string) {
    const log = await this.prisma.notificationLog.findFirst({ where: { id, vendorId } });
    if (!log) throw new NotFoundException('Notification log not found');
    if (log.status !== 'FAILED') throw new BadRequestException('Only failed sends can be retried');
    if (!log.jobName || !log.payload) {
      throw new BadRequestException('This send predates retry support and cannot be retried');
    }
    if (log.retriedAt) throw new BadRequestException('This send was already retried');

    // The vendor may have turned this notification off since it failed — don't send what they switched off.
    const jobData = log.payload as Record<string, unknown>;
    const type = (jobData['type'] ?? log.eventType) as NotificationType | undefined;
    if (type && log.channel === 'WHATSAPP') {
      const enabled = await this.settings.isEnabled(vendorId, type, NotificationChannel.WHATSAPP);
      if (!enabled) throw new BadRequestException('This notification type is turned off in settings, so it was not retried');
    }

    // Claim first so a double-click cannot queue the message twice.
    const claimed = await this.prisma.notificationLog.updateMany({
      where: { id, retriedAt: null },
      data: { retriedAt: new Date() },
    });
    if (!claimed.count) throw new BadRequestException('This send was already retried');

    try {
      await this.enqueueRetry(log.id, log.jobName, log.payload as Record<string, unknown>);
    } catch (err) {
      await this.prisma.notificationLog.update({ where: { id }, data: { retriedAt: null } });
      throw err;
    }
    return { queued: true };
  }

  /** Re-queues a failed send; the job carries `retryOfLogId` so the row it produces points back at this one. */
  private enqueueRetry(logId: string, jobName: string, payload: Record<string, unknown>, delayMs = 0) {
    return this.notificationQueue.add(
      jobName,
      { ...payload, retryOfLogId: logId },
      { ...(retryOptionsFor(jobName) ?? {}), ...(delayMs > 0 ? { delay: delayMs } : {}) },
    );
  }

  /**
   * What "Retry all failed" would do for the current filters — without doing it.
   *
   * Only failures whose retry cannot message a customer twice are touched:
   *  - rows Meta/the network proved never delivered (`retryable = true`) are always safe;
   *  - older rows (`retryable = null`, written before failures were classified) are counted separately and only
   *    included when the caller explicitly opts in;
   *  - rows that failed permanently (`retryable = false`: bad number, template missing…) are never re-sent;
   *  - a row is skipped when a LATER send to the same recipient for the same delivery already succeeded, when its
   *    notification type has since been switched off, or when it duplicates another candidate in the same batch.
   */
  async previewBulkRetry(vendorId: string, dto: BulkRetryDto) {
    const plan = await this.planBulkRetry(vendorId, dto);
    return plan.summary;
  }

  async bulkRetry(vendorId: string, dto: BulkRetryDto) {
    const plan = await this.planBulkRetry(vendorId, dto);
    const targets = [...plan.safe, ...(dto.includeLegacy ? plan.legacy : [])];

    let queued = 0;
    let failedToQueue = 0;
    for (const log of targets) {
      // Claim first (same guard as the single Retry) so overlapping clicks can never queue a row twice.
      const claimed = await this.prisma.notificationLog.updateMany({
        where: { id: log.id, retriedAt: null },
        data: { retriedAt: new Date() },
      });
      if (!claimed.count) continue;
      try {
        // Staggered so a few hundred retries do not hit Meta's throughput limit in the same second.
        await this.enqueueRetry(log.id, log.jobName as string, log.payload as Record<string, unknown>, queued * BULK_RETRY_STAGGER_MS);
        queued++;
      } catch {
        failedToQueue++;
        await this.prisma.notificationLog.update({ where: { id: log.id }, data: { retriedAt: null } });
      }
    }
    return { queued, failedToQueue, ...plan.summary, includedLegacy: !!dto.includeLegacy };
  }

  private async planBulkRetry(vendorId: string, dto: BulkRetryDto) {
    const { includeLegacy: _ignored, ...filters } = dto;
    const base = await this.buildWhere(vendorId, { ...filters, channel: 'WHATSAPP', status: 'FAILED' } as NotificationLogQueryDto);
    const candidateWhere = { AND: [base, { retriedAt: null, jobName: { not: null } }] };

    const [rows, totalMatching, permanent] = await Promise.all([
      this.prisma.notificationLog.findMany({
        where: { AND: [candidateWhere, { OR: [{ retryable: null }, { retryable: true }] }] },
        orderBy: { createdAt: 'asc' },
        take: BULK_RETRY_MAX,
      }),
      this.prisma.notificationLog.count({ where: candidateWhere }),
      this.prisma.notificationLog.count({ where: { AND: [candidateWhere, { retryable: false }] } }),
    ]);

    const usable = rows.filter((r) => r.jobName && r.payload);

    // Later successful sends to the same recipient for the same delivery → nothing left to retry.
    const recipients = [...new Set(usable.map((r) => r.recipientAddress).filter(Boolean))] as string[];
    const laterSent = recipients.length
      ? await this.prisma.notificationLog.findMany({
          where: {
            vendorId,
            channel: 'WHATSAPP',
            status: 'SENT',
            recipientAddress: { in: recipients },
            createdAt: { gte: usable[0].createdAt },
          },
          select: { recipientAddress: true, eventType: true, entityId: true, createdAt: true },
        })
      : [];

    const enabledByType = new Map<string, boolean>();
    const isEnabled = async (type: string | undefined) => {
      if (!type) return true;
      if (!enabledByType.has(type)) {
        enabledByType.set(type, await this.settings.isEnabled(vendorId, type as NotificationType, NotificationChannel.WHATSAPP));
      }
      return enabledByType.get(type) as boolean;
    };

    const safe: typeof usable = [];
    const legacy: typeof usable = [];
    let disabled = 0;
    let alreadyDelivered = 0;
    let duplicate = 0;
    const seen = new Set<string>();

    for (const row of usable) {
      const type = ((row.payload as Record<string, unknown>)['type'] ?? row.eventType) as string | undefined;
      if (!(await isEnabled(type))) { disabled++; continue; }

      const delivered = laterSent.some(
        (s) =>
          s.recipientAddress === row.recipientAddress &&
          (s.eventType ?? null) === (row.eventType ?? null) &&
          s.createdAt > row.createdAt &&
          (!row.entityId || s.entityId === row.entityId),
      );
      if (delivered) { alreadyDelivered++; continue; }

      const key = `${row.recipientAddress}|${row.eventType}|${row.entityId ?? row.id}`;
      if (seen.has(key)) { duplicate++; continue; }
      seen.add(key);

      (row.retryable === true ? safe : legacy).push(row);
    }

    return {
      safe,
      legacy,
      summary: {
        matching: totalMatching,
        /** Failed, never delivered for sure (network/upload) — retried by default. */
        retryable: safe.length,
        /** Failed before failures were classified — retried only when `includeLegacy` is sent. */
        legacy: legacy.length,
        skipped: { permanent, disabled, alreadyDelivered, duplicate },
        /** More matching rows than one pass handles — run it again after this finishes. */
        capped: totalMatching - permanent > rows.length,
      },
    };
  }

  private errorClause(category: string): any {
    switch (category) {
      case 'DISABLED':
        return { lastError: { contains: 'Disabled by vendor', mode: 'insensitive' } };
      case 'NOT_DELIVERED':
        return { lastError: { contains: 'not delivered', mode: 'insensitive' } };
      default: // API_ERROR — any other recorded error
        return {
          AND: [
            { lastError: { not: null } },
            { NOT: { lastError: { contains: 'Disabled by vendor', mode: 'insensitive' } } },
            { NOT: { lastError: { contains: 'not delivered', mode: 'insensitive' } } },
          ],
        };
    }
  }

  private async buildWhere(vendorId: string, query: NotificationLogQueryDto, opts: { ignoreStatus?: boolean } = {}) {
    const {
      channel, status, eventType, recipientType, recipientId, search, dateFrom, dateTo,
      vanId, dailySheetId, sheetDate, customerId, errorCategory, deliveryStatus,
    } = query;

    const where: any = { vendorId };
    const and: any[] = [];
    if (channel) where.channel = channel;
    if (status && !opts.ignoreStatus) where.status = status;
    if (eventType) where.eventType = eventType;
    if (recipientType) where.recipientType = recipientType;
    if (recipientId) where.recipientId = recipientId;
    if (errorCategory) and.push(this.errorClause(errorCategory));
    if (deliveryStatus === 'PENDING') and.push({ status: 'SENT', channel: 'WHATSAPP', deliveryStatus: null });
    else if (deliveryStatus) where.deliveryStatus = deliveryStatus;

    if (search?.trim()) {
      const customers = await this.prisma.customer.findMany({
        where: {
          vendorId,
          OR: [
            { name: { contains: search.trim(), mode: 'insensitive' } },
            { customerCode: { contains: search.trim(), mode: 'insensitive' } },
            { phoneNumber: { contains: search.trim() } },
          ],
        },
        select: { id: true, phoneNumber: true },
        take: 50,
      });
      and.push({
        OR: [
          { recipientAddress: { contains: search.trim(), mode: 'insensitive' } },
          ...(await this.customerClauses(customers)),
        ],
      });
    }

    if (customerId) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: customerId, vendorId },
        select: { id: true, phoneNumber: true },
      });
      and.push({ OR: customer ? await this.customerClauses([customer]) : [{ id: '__none__' }] });
    }

    // Van / sheet / sheet-date all resolve through the delivery items of matching sheets.
    if (vanId || dailySheetId || sheetDate) {
      const items = await this.prisma.dailySheetItem.findMany({
        where: {
          dailySheet: {
            vendorId,
            ...(vanId ? { vanId } : {}),
            ...(dailySheetId ? { id: dailySheetId } : {}),
            ...(sheetDate
              ? { date: { gte: this.dayBoundary(sheetDate, false), lte: this.dayBoundary(sheetDate, true) } }
              : {}),
          },
        },
        select: { id: true },
        take: MAX_ITEM_IDS,
      });
      and.push({ entityType: 'DELIVERY_ITEM', entityId: { in: items.map((i) => i.id) } });
    }

    // Vendor days are Asia/Karachi (UTC+5): a bare YYYY-MM-DD means that whole local day,
    // so From = start of day and To = end of day (same date on both sides = one day).
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = this.dayBoundary(dateFrom, false);
      if (dateTo) where.createdAt.lte = this.dayBoundary(dateTo, true);
    }

    if (and.length) where.AND = and;
    return where;
  }

  private dayBoundary(value: string, endOfDay: boolean): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+05:00`);
    }
    return new Date(value); // full ISO timestamp — use as given
  }

  /**
   * Logs only carry loose ids, so a customer's sends are matched by recipientId,
   * by delivery-item entity, or by their phone number (rows with no recipient id).
   */
  private async customerClauses(customers: { id: string; phoneNumber: string }[]) {
    if (!customers.length) return [];
    const ids = customers.map((c) => c.id);
    const phones = [...new Set(customers.map((c) => normalizePhone(c.phoneNumber)).filter(Boolean))] as string[];
    const items = await this.prisma.dailySheetItem.findMany({
      where: { customerId: { in: ids } },
      select: { id: true },
      take: 5000,
    });

    const clauses: any[] = [{ recipientType: 'CUSTOMER', recipientId: { in: ids } }];
    if (phones.length) clauses.push({ recipientAddress: { in: phones } });
    if (items.length) clauses.push({ entityType: 'DELIVERY_ITEM', entityId: { in: items.map((i) => i.id) } });
    return clauses;
  }

  /**
   * Attaches customer name/code + the daily sheet a delivery notification belongs to.
   * recipientId/entityId are loose string fields (not Prisma relations), so this is a
   * manual batch join rather than a Prisma `include`.
   *
   * Many notification producers (Record Payment, order updates, ticket replies)
   * enqueue with only `{ vendorId, type }` and no recipient metadata, so their
   * rows have neither `recipientId` nor `entityId` — historically that left the
   * customer column blank, most visibly on FAILED sends. As a last resort we
   * match `recipientAddress` (the phone number) against the vendor's customers.
   */
  private async attachCustomerAndSheet<T extends { recipientType: string | null; recipientId: string | null; entityType: string | null; entityId: string | null; recipientAddress?: string | null }>(
    vendorId: string,
    logs: T[],
  ) {
    const deliveryItemIds = [...new Set(logs.filter((l) => l.entityType === 'DELIVERY_ITEM' && l.entityId).map((l) => l.entityId as string))];
    const items = deliveryItemIds.length
      ? await this.prisma.dailySheetItem.findMany({
          where: { id: { in: deliveryItemIds } },
          select: { id: true, dailySheetId: true, customerId: true },
        })
      : [];
    const itemById = new Map(items.map((i) => [i.id, i]));

    const customerIds = new Set<string>();
    for (const log of logs) {
      if (log.recipientType === 'CUSTOMER' && log.recipientId) customerIds.add(log.recipientId);
      const item = log.entityType === 'DELIVERY_ITEM' && log.entityId ? itemById.get(log.entityId) : undefined;
      if (item?.customerId) customerIds.add(item.customerId);
    }
    const customers = customerIds.size
      ? await this.prisma.customer.findMany({
          where: { id: { in: [...customerIds] } },
          select: { id: true, name: true, customerCode: true },
        })
      : [];
    const customerById = new Map(customers.map((c) => [c.id, c]));

    const resolvedCustomerId = (log: T) =>
      (log.recipientType === 'CUSTOMER' ? log.recipientId : null) ??
      (log.entityType === 'DELIVERY_ITEM' && log.entityId ? itemById.get(log.entityId)?.customerId : undefined) ??
      null;

    // Phone-number fallback for rows that carry no usable recipient/entity id.
    const unresolvedPhones = new Set(
      logs
        .filter((l) => !resolvedCustomerId(l) && normalizePhone(l.recipientAddress))
        .map((l) => normalizePhone(l.recipientAddress)),
    );
    const customerByPhone = new Map<string, { id: string; name: string; customerCode: string }>();
    if (unresolvedPhones.size) {
      // phoneNumber is a required column, so the guard is against the "" / "-"
      // placeholder rows, not null (matches the balance-reminder query).
      const withPhones = await this.prisma.customer.findMany({
        where: { vendorId, phoneNumber: { not: '' } },
        select: { id: true, name: true, customerCode: true, phoneNumber: true },
      });
      for (const c of withPhones) {
        const key = normalizePhone(c.phoneNumber);
        if (key && !customerByPhone.has(key)) customerByPhone.set(key, c);
      }
    }

    return logs.map((log) => {
      const item = log.entityType === 'DELIVERY_ITEM' && log.entityId ? itemById.get(log.entityId) : undefined;
      const customerId = resolvedCustomerId(log);
      const customer =
        (customerId ? customerById.get(customerId) : undefined) ??
        customerByPhone.get(normalizePhone(log.recipientAddress));
      const { payload, ...rest } = log as any; // payload can be large (receipt data) — never sent to the list
      return {
        ...(rest as T),
        canRetry: rest.status === 'FAILED' && !!rest.jobName && !!payload && !rest.retriedAt,
        customerId: customer?.id ?? null,
        customerName: customer?.name ?? null,
        customerCode: customer?.customerCode ?? null,
        dailySheetId: item?.dailySheetId ?? null,
      };
    });
  }

  async findLogById(vendorId: string, id: string) {
    const log = await this.prisma.notificationLog.findFirst({ where: { id, vendorId } });
    if (!log) throw new NotFoundException('Notification log not found');
    return log;
  }

  /** Records a send that never reached the queue because the vendor disabled this flow/channel. */
  async logSkipped(params: {
    channel: string;
    recipientAddress?: string | null;
    eventType?: string | null;
    entityType?: string | null;
    entityId?: string | null;
    recipientType?: string | null;
    recipientId?: string | null;
    vendorId?: string | null;
  }) {
    await this.prisma.notificationLog
      .create({
        data: {
          channel: params.channel,
          status: 'SKIPPED',
          recipientAddress: params.recipientAddress ?? null,
          eventType: params.eventType ?? null,
          entityType: params.entityType ?? null,
          entityId: params.entityId ?? null,
          recipientType: params.recipientType ?? null,
          recipientId: params.recipientId ?? null,
          vendorId: params.vendorId ?? null,
          attemptCount: 0,
          lastError: 'Disabled by vendor notification settings',
          queuedAt: new Date(),
        },
      })
      .catch(() => null);
  }
}
