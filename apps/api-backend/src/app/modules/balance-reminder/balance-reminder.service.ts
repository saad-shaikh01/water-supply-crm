import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '@water-supply-crm/database';
import { NotificationType, NotificationChannel } from '@prisma/client';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { CloudTemplateNames } from '../whatsapp/templates/cloud-template-names';
import { isSendablePhone } from '../whatsapp/phone.util';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { NotificationSettingsService } from '../notifications/notification-settings.service';
import { CustomerStatementPdfService } from '../customer/pdf/customer-statement-pdf.service';
import { ScheduleReminderDto, SendNowDto, SendTargetedDto, PreviewDto } from './dto/schedule-reminder.dto';

const DEFAULT_CRON = '0 4 * * *'; // 9 AM PKT (UTC+5) — stored as UTC
const DEFAULT_MIN_BALANCE = 100;
const REPEATABLE_JOB_ID = (vendorId: string) => `balance-reminder:${vendorId}`;
const REMINDER_COOLDOWN_TTL = 23 * 60 * 60; // 23 hours — prevent re-sending within same day
const cooldownKey = (vendorId: string, customerId: string) => `balance-reminder-cooldown:${vendorId}:${customerId}`;

/**
 * Pause between consecutive WhatsApp sends — avoids burst pattern that triggers
 * Meta anti-spam. Randomized per message: a fixed interval is itself a bot
 * signature, so never use a static delay.
 */
const SEND_DELAY_MIN_MS = 5000;
const SEND_DELAY_MAX_MS = 12000;

/** Stable response shape returned by all schedule-related endpoints */
export interface ReminderScheduleStatus {
  vendorId: string;
  scheduled: boolean;
  cronExpression: string | null;
  minBalance: number | null;
  nextRunAt: string | null;
}

@Injectable()
export class BalanceReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BalanceReminderService.name);
  private redis: Redis;

  constructor(
    @InjectQueue(QUEUE_NAMES.BALANCE_REMINDERS)
    private readonly reminderQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly notifSettings: NotificationSettingsService,
    private readonly statementPdf: CustomerStatementPdfService,
  ) {}

  async onModuleInit() {
    const redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379';
    this.redis = new Redis(redisUrl);

    try {
      await this.reconcileSchedulesOnBoot();
    } catch (err) {
      this.logger.error(
        `Failed to reconcile balance-reminder schedules: ${(err as Error)?.message ?? String(err)}`,
        (err as Error)?.stack,
      );
    }
  }

  async onModuleDestroy() {
    await this.redis?.quit();
  }

  // ─── Schedule management ────────────────────────────────────────────────────

  /**
   * Removes both the legacy repeatable job (registered via add({repeat, jobId})
   * in older builds) and the current job-scheduler entry for this vendor.
   * add({repeat}) is first-write-wins and its removal via removeRepeatableByKey
   * is unreliable across BullMQ versions — a "cancelled" schedule could keep
   * firing forever even after the DB config was deleted. Always sweep the
   * legacy form explicitly, never rely on removeJobScheduler alone.
   */
  private async removeQueueJob(vendorId: string): Promise<void> {
    const jobId = REPEATABLE_JOB_ID(vendorId);

    const legacy = await this.reminderQueue.getRepeatableJobs();
    for (const j of legacy.filter((j) => j.id === jobId)) {
      await this.reminderQueue.removeRepeatableByKey(j.key);
      this.logger.warn(`Removed legacy balance-reminder repeatable job for vendor ${vendorId} (key=${j.key}, pattern=${j.pattern})`);
    }

    await this.reminderQueue.removeJobScheduler(jobId);
  }

  /**
   * Startup sweep: reconciles every vendor's schedule against ReminderScheduleConfig.
   * Any queue job for a vendor with no active config is removed (catches zombie
   * jobs left behind by the legacy add({repeat}) API); every vendor with an
   * active config gets its scheduler re-upserted so pattern/minBalance changes
   * made while the server was down still take effect.
   */
  private async reconcileSchedulesOnBoot(): Promise<void> {
    const configs = await this.prisma.reminderScheduleConfig.findMany();
    const configByVendor = new Map(configs.map((c) => [c.vendorId, c]));

    const queuedJobs = await this.reminderQueue.getRepeatableJobs();
    const prefix = 'balance-reminder:';
    let orphansRemoved = 0;

    for (const job of queuedJobs) {
      if (!job.id?.startsWith(prefix)) continue;
      const vendorId = job.id.slice(prefix.length);
      if (!configByVendor.has(vendorId)) {
        await this.removeQueueJob(vendorId);
        orphansRemoved++;
        this.logger.warn(`Removed orphaned balance-reminder schedule for vendor ${vendorId} (no active config) — pattern=${job.pattern}`);
      }
    }

    for (const config of configs) {
      const jobId = REPEATABLE_JOB_ID(config.vendorId);
      await this.reminderQueue.upsertJobScheduler(
        jobId,
        { pattern: config.cronExpression, tz: 'UTC' },
        {
          name: JOB_NAMES.SEND_BALANCE_REMINDERS,
          data: { vendorId: config.vendorId, minBalance: config.minBalance },
          opts: { removeOnComplete: 50, removeOnFail: 20 },
        },
      );
    }

    this.logger.log(`Balance reminder schedules reconciled: ${configs.length} active, ${orphansRemoved} orphaned job(s) removed`);
  }

  async scheduleReminders(
    vendorId: string,
    dto: ScheduleReminderDto,
  ): Promise<ReminderScheduleStatus & { message: string }> {
    const cronExpression = dto.cronExpression ?? DEFAULT_CRON;
    const minBalance = dto.minBalance ?? DEFAULT_MIN_BALANCE;
    const jobId = REPEATABLE_JOB_ID(vendorId);

    await this.removeQueueJob(vendorId);

    // upsertJobScheduler (not add({repeat})) — see removeQueueJob for why the
    // legacy API is never used to create the schedule anymore.
    const job = await this.reminderQueue.upsertJobScheduler(
      jobId,
      { pattern: cronExpression, tz: 'UTC' },
      {
        name: JOB_NAMES.SEND_BALANCE_REMINDERS,
        data: { vendorId, minBalance },
        opts: { removeOnComplete: 50, removeOnFail: 20 },
      },
    );

    await this.prisma.reminderScheduleConfig.upsert({
      where: { vendorId },
      update: { cronExpression, minBalance },
      create: { vendorId, cronExpression, minBalance },
    });

    const nextRunAt = job ? new Date(job.timestamp + (job.delay ?? 0)).toISOString() : null;

    this.logger.log(`Scheduled balance reminders for vendor ${vendorId}: ${cronExpression}, minBalance=${minBalance}`);
    return { vendorId, scheduled: true, cronExpression, minBalance, nextRunAt, message: 'Balance reminder schedule configured' };
  }

  async cancelReminders(vendorId: string): Promise<ReminderScheduleStatus & { message: string }> {
    await this.removeQueueJob(vendorId);
    await this.prisma.reminderScheduleConfig.deleteMany({ where: { vendorId } });
    return { vendorId, scheduled: false, cronExpression: null, minBalance: null, nextRunAt: null, message: 'Balance reminder schedule removed' };
  }

  async getScheduleStatus(vendorId: string): Promise<ReminderScheduleStatus> {
    const config = await this.prisma.reminderScheduleConfig.findUnique({ where: { vendorId } });
    if (!config) return { vendorId, scheduled: false, cronExpression: null, minBalance: null, nextRunAt: null };

    const jobId = REPEATABLE_JOB_ID(vendorId);
    const scheduler = await this.reminderQueue.getJobScheduler(jobId);
    const nextRunAt = scheduler?.next ? new Date(scheduler.next).toISOString() : null;

    return { vendorId, scheduled: true, cronExpression: config.cronExpression, minBalance: config.minBalance, nextRunAt };
  }

  // ─── Send operations ────────────────────────────────────────────────────────

  async sendNow(vendorId: string, dto: SendNowDto) {
    return this.processVendorReminders(
      vendorId,
      dto.minBalance ?? DEFAULT_MIN_BALANCE,
      dto.dryRun ?? false,
      dto.month ?? this.currentMonth(),
      dto.includeStatement ?? false,
      dto.paymentType,
      false,
      'manual',
      dto.vanId,
      dto.dayOfWeek,
      dto.excludeCustomerIds,
    );
  }

  async sendTargeted(vendorId: string, dto: SendTargetedDto) {
    const minBalance = dto.minBalance ?? DEFAULT_MIN_BALANCE;
    const dryRun = dto.dryRun ?? false;
    const force = dto.force ?? false;
    const month = dto.month ?? this.currentMonth();
    const includeStatement = dto.includeStatement ?? false;
    const paymentType = dto.paymentType;
    const endDate = this.monthEndDate(month);

    if (dto.mode === 'eligible') {
      return this.processVendorReminders(vendorId, minBalance, dryRun, month, includeStatement, paymentType, force, 'manual', dto.vanId, dto.dayOfWeek, dto.excludeCustomerIds);
    }

    const customerIds = dto.customerIds ?? [];
    if (customerIds.length === 0) {
      return { vendorId, sent: 0, skipped: 0, dryRun, month, includeStatement, customers: [], error: 'customerIds is required for mode=single or mode=selected' };
    }

    const customers = await this.prisma.customer.findMany({
      where: { id: { in: customerIds }, vendorId, isActive: true, phoneNumber: { not: '' } },
      select: { id: true, name: true, phoneNumber: true, financialBalance: true },
    });

    if (customers.length === 0) {
      return { vendorId, sent: 0, skipped: 0, dryRun, month, includeStatement, customers: [] };
    }

    // Calculate month-end balance for each customer (single batch query)
    const monthEndBalances = await this.getMonthEndBalanceMap(vendorId, customers, endDate);

    let sent = 0;
    let skipped = 0;
    const results: Array<{ customerId: string; name: string; balance: number; status: string; statementUrl?: string | null }> = [];

    for (let i = 0; i < customers.length; i++) {
      const customer = customers[i];
      const monthBalance = monthEndBalances.get(customer.id) ?? customer.financialBalance;

      // Junk phone ("-", partial digits etc.) — never attempt a send
      if (!this.isValidPhone(customer.phoneNumber)) {
        results.push({ customerId: customer.id, name: customer.name, balance: monthBalance, status: 'skipped-invalid-phone', statementUrl: null });
        skipped++;
        continue;
      }

      if (dryRun) {
        results.push({ customerId: customer.id, name: customer.name, balance: monthBalance, status: 'would-send', statementUrl: includeStatement ? '(statement PDF attached at send time)' : null });
        skipped++;
        continue;
      }

      // WhatsApp dropped mid-batch — abort instead of burning 5s per remaining customer
      if (!this.whatsapp.isReady()) {
        this.logger.warn(`WhatsApp disconnected mid-batch — aborting, ${customers.length - i} customers remaining`);
        for (let j = i; j < customers.length; j++) {
          const c = customers[j];
          results.push({ customerId: c.id, name: c.name, balance: monthEndBalances.get(c.id) ?? c.financialBalance, status: 'skipped-disconnected', statementUrl: null });
          skipped++;
        }
        break;
      }

      // Enforce cooldown unless force=true
      if (!force) {
        const cdKey = cooldownKey(vendorId, customer.id);
        const onCooldown = await this.redis.exists(cdKey);
        if (onCooldown) {
          results.push({ customerId: customer.id, name: customer.name, balance: monthBalance, status: 'skipped-cooldown', statementUrl: null });
          skipped++;
          continue;
        }
      }

      const messageSent = await this.sendReminder(vendorId, customer, monthBalance, month, includeStatement);
      if (messageSent) {
        await this.redis.set(cooldownKey(vendorId, customer.id), '1', 'EX', REMINDER_COOLDOWN_TTL);
        sent++;
      } else { skipped++; }
      results.push({ customerId: customer.id, name: customer.name, balance: monthBalance, status: messageSent ? 'sent' : 'failed', statementUrl: null });

      if (i < customers.length - 1) {
        await this.sendDelay();
      }
    }

    this.logger.log(`Targeted reminders vendor=${vendorId} mode=${dto.mode} sent=${sent} skipped=${skipped} dryRun=${dryRun} force=${force} month=${month}`);

    if (!dryRun) {
      await this.prisma.reminderSendLog.create({
        data: {
          vendorId, trigger: 'manual', mode: dto.mode, month, sent, skipped, includeStatement, dryRun,
          force,
          details: this.toLogDetails(results),
        },
      });
    }

    return { vendorId, sent, skipped, dryRun, month, includeStatement, customers: results };
  }

  async previewReminders(vendorId: string, dto: PreviewDto) {
    const minBalance = dto.minBalance ?? DEFAULT_MIN_BALANCE;
    const mode = dto.mode ?? 'eligible';
    const month = dto.month ?? this.currentMonth();
    const includeStatement = dto.includeStatement ?? false;
    const paymentType = dto.paymentType;
    const endDate = this.monthEndDate(month);

    const whereBase = mode === 'eligible'
      ? { vendorId, ...(paymentType ? { paymentType } : {}), ...this.scheduleFilter(dto.vanId, dto.dayOfWeek) }
      : { id: { in: dto.customerIds ?? [] }, vendorId };

    const candidates = await this.prisma.customer.findMany({
      where: whereBase,
      select: { id: true, name: true, customerCode: true, phoneNumber: true, financialBalance: true, isActive: true, paymentType: true, createdAt: true },
      orderBy: { financialBalance: 'desc' },
    });

    // One batch query: get all transactions after month-end for all candidates
    const monthEndBalances = await this.getMonthEndBalanceMap(vendorId, candidates, endDate);

    // Batch-check Redis cooldown keys for all candidates in one pipeline
    const cooldownPipeline = this.redis.pipeline();
    for (const c of candidates) {
      cooldownPipeline.exists(cooldownKey(vendorId, c.id));
    }
    const cooldownResults = await cooldownPipeline.exec();
    const onCooldownSet = new Set<string>(
      candidates
        .filter((_, i) => (cooldownResults?.[i]?.[1] as number) === 1)
        .map((c) => c.id),
    );

    type PreviewEntry = { customerId: string; name: string; customerCode: string; balance: number; phone: string; paymentType: string; reason: string };
    const wouldSend: PreviewEntry[] = [];
    const skipped: PreviewEntry[] = [];

    for (const c of candidates) {
      const monthBalance = monthEndBalances.get(c.id) ?? c.financialBalance;
      const entry: PreviewEntry = { customerId: c.id, name: c.name, customerCode: c.customerCode, balance: monthBalance, phone: c.phoneNumber, paymentType: c.paymentType, reason: '' };

      if (!c.isActive) {
        entry.reason = 'skipped-inactive';
        skipped.push(entry);
      } else if (!c.phoneNumber || c.phoneNumber.trim() === '') {
        entry.reason = 'skipped-no-phone';
        skipped.push(entry);
      } else if (!this.isValidPhone(c.phoneNumber)) {
        entry.reason = 'skipped-invalid-phone';
        skipped.push(entry);
      } else if (c.createdAt >= endDate) {
        entry.reason = 'skipped-new-customer';
        skipped.push(entry);
      } else if (monthBalance < minBalance) {
        entry.reason = 'skipped-low-balance';
        skipped.push(entry);
      } else if (onCooldownSet.has(c.id)) {
        entry.reason = 'skipped-cooldown';
        skipped.push(entry);
      } else {
        entry.reason = 'would-send';
        wouldSend.push(entry);
      }
    }

    return { vendorId, mode, minBalance, month, includeStatement, paymentType: paymentType ?? 'BOTH', totalWouldSend: wouldSend.length, totalSkipped: skipped.length, wouldSend, skipped };
  }

  /** Core logic — called by BullMQ processor and sendNow */
  async processVendorReminders(
    vendorId: string,
    minBalance: number,
    dryRun = false,
    month?: string,
    includeStatement = false,
    paymentType?: 'MONTHLY' | 'CASH',
    force = false,
    trigger: 'cron' | 'manual' = 'cron',
    vanId?: string,
    dayOfWeek?: number,
    excludeCustomerIds?: string[],
  ) {
    const targetMonth = month ?? this.currentMonth();
    const endDate = this.monthEndDate(targetMonth);
    const excludeSet = new Set(excludeCustomerIds ?? []);

    // Fetch all active candidates with phone — do NOT filter by balance at DB level
    // because we need month-end balance (historical), not today's live balance.
    const candidates = await this.prisma.customer.findMany({
      where: {
        vendorId,
        ...(paymentType ? { paymentType } : {}),
        ...this.scheduleFilter(vanId, dayOfWeek),
        isActive: true,
        phoneNumber: { not: '' },
      },
      select: { id: true, name: true, phoneNumber: true, financialBalance: true, createdAt: true },
      orderBy: { financialBalance: 'desc' },
    });

    if (candidates.length === 0) {
      this.logger.log(`No active customers with phone for vendor ${vendorId}`);
      return { vendorId, sent: 0, skipped: 0, dryRun, month: targetMonth, includeStatement, paymentType: paymentType ?? 'BOTH', customers: [] };
    }

    // One batch query for post-month transactions
    const monthEndBalances = await this.getMonthEndBalanceMap(vendorId, candidates, endDate);

    // Filter to those with month-end balance >= minBalance
    const eligible = candidates.filter((c) => (monthEndBalances.get(c.id) ?? c.financialBalance) >= minBalance);

    if (eligible.length === 0) {
      this.logger.log(`No customers with month-end balance >= ${minBalance} for vendor ${vendorId} (${targetMonth})`);
      return { vendorId, sent: 0, skipped: 0, dryRun, month: targetMonth, includeStatement, paymentType: paymentType ?? 'BOTH', customers: [] };
    }

    let sent = 0;
    let skipped = 0;
    const results: Array<{ customerId: string; name: string; balance: number; status: string; statementUrl?: string | null }> = [];

    for (let i = 0; i < eligible.length; i++) {
      const customer = eligible[i];
      const monthBalance = monthEndBalances.get(customer.id) ?? customer.financialBalance;

      // Customer joined after the billing month ended — no statement/reminder applies
      if (customer.createdAt >= endDate) {
        results.push({ customerId: customer.id, name: customer.name, balance: monthBalance, status: 'skipped-new-customer', statementUrl: null });
        skipped++;
        continue;
      }

      // Manually excluded in preview
      if (excludeSet.has(customer.id)) {
        results.push({ customerId: customer.id, name: customer.name, balance: monthBalance, status: 'skipped-excluded', statementUrl: null });
        skipped++;
        continue;
      }

      // Junk phone ("-", partial digits etc.) — never attempt a send
      if (!this.isValidPhone(customer.phoneNumber)) {
        results.push({ customerId: customer.id, name: customer.name, balance: monthBalance, status: 'skipped-invalid-phone', statementUrl: null });
        skipped++;
        continue;
      }

      if (dryRun) {
        results.push({ customerId: customer.id, name: customer.name, balance: monthBalance, status: 'would-send', statementUrl: includeStatement ? '(statement PDF attached at send time)' : null });
        skipped++;
        continue;
      }

      // WhatsApp dropped mid-batch — abort instead of burning 5s per remaining customer
      if (!this.whatsapp.isReady()) {
        this.logger.warn(`WhatsApp disconnected mid-batch — aborting, ${eligible.length - i} customers remaining`);
        for (let j = i; j < eligible.length; j++) {
          const c = eligible[j];
          results.push({ customerId: c.id, name: c.name, balance: monthEndBalances.get(c.id) ?? c.financialBalance, status: 'skipped-disconnected', statementUrl: null });
          skipped++;
        }
        break;
      }

      // Enforce per-customer cooldown unless force=true
      if (!force) {
        const cdKey = cooldownKey(vendorId, customer.id);
        const onCooldown = await this.redis.exists(cdKey);
        if (onCooldown) {
          results.push({ customerId: customer.id, name: customer.name, balance: monthBalance, status: 'skipped-cooldown', statementUrl: null });
          skipped++;
          continue;
        }
      }

      const messageSent = await this.sendReminder(vendorId, customer, monthBalance, targetMonth, includeStatement);
      if (messageSent) {
        await this.redis.set(cooldownKey(vendorId, customer.id), '1', 'EX', REMINDER_COOLDOWN_TTL);
        sent++;
      } else {
        skipped++;
      }
      results.push({ customerId: customer.id, name: customer.name, balance: monthBalance, status: messageSent ? 'sent' : 'failed', statementUrl: null });

      if (i < eligible.length - 1) {
        await this.sendDelay();
      }
    }

    this.logger.log(`Balance reminders vendor=${vendorId} sent=${sent} skipped=${skipped} dryRun=${dryRun} force=${force} month=${targetMonth} includeStatement=${includeStatement}`);

    if (!dryRun) {
      await this.prisma.reminderSendLog.create({
        data: {
          vendorId, trigger, mode: 'eligible', month: targetMonth, sent, skipped, includeStatement, dryRun,
          minBalance,
          paymentType: paymentType ?? null,
          vanId: vanId ?? null,
          dayOfWeek: dayOfWeek ?? null,
          force,
          details: this.toLogDetails(results),
        },
      });
    }

    return { vendorId, sent, skipped, dryRun, month: targetMonth, includeStatement, paymentType: paymentType ?? 'BOTH', customers: results };
  }

  // ─── History ────────────────────────────────────────────────────────────────

  async getSendHistory(
    vendorId: string,
    page: number,
    limit: number,
    filters?: { dateFrom?: string; dateTo?: string; result?: string },
  ) {
    const where: any = { vendorId };

    if (filters?.dateFrom || filters?.dateTo) {
      where.createdAt = {};
      if (filters.dateFrom) where.createdAt.gte = new Date(`${filters.dateFrom}T00:00:00`);
      if (filters.dateTo) where.createdAt.lte = new Date(`${filters.dateTo}T23:59:59.999`);
    }

    // result filter: logs where at least one message was sent / skipped
    if (filters?.result === 'sent') where.sent = { gt: 0 };
    else if (filters?.result === 'skipped') where.skipped = { gt: 0 };

    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      this.prisma.reminderSendLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        // details (per-customer JSON, up to 100s of entries) is fetched per-row
        // via getSendLogDetail — keep the list payload light.
        omit: { details: true },
      }),
      this.prisma.reminderSendLog.count({ where }),
    ]);
    return { data: logs, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async getSendLogDetail(vendorId: string, id: string) {
    return this.prisma.reminderSendLog.findFirst({ where: { id, vendorId } });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Prisma where-fragment restricting customers by their delivery schedule.
   * vanId and dayOfWeek combine into a single `some` so both must match the SAME
   * schedule entry (e.g. "Van A on Monday", not "Van A any day AND any van Monday").
   */
  private scheduleFilter(vanId?: string, dayOfWeek?: number) {
    if (!vanId && !dayOfWeek) return {};
    return {
      deliverySchedules: {
        some: {
          ...(vanId ? { vanId } : {}),
          ...(dayOfWeek ? { dayOfWeek } : {}),
        },
      },
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Random human-like pause between sends (SEND_DELAY_MIN_MS–SEND_DELAY_MAX_MS) */
  private sendDelay(): Promise<void> {
    const ms = SEND_DELAY_MIN_MS + Math.floor(Math.random() * (SEND_DELAY_MAX_MS - SEND_DELAY_MIN_MS));
    return this.sleep(ms);
  }

  /**
   * A phone is sendable if it normalizes to digits-only WITH country code
   * (see phone.util.ts). Catches junk like "-", "n/a" or partial numbers
   * that would otherwise produce a broken WhatsApp chat id.
   */
  private isValidPhone(phone: string | null | undefined): boolean {
    return isSendablePhone(phone);
  }

  /** Strip statementUrl (signed URLs expire in 7 days — pointless to persist) before logging results */
  private toLogDetails(
    results: Array<{ customerId: string; name: string; balance: number; status: string }>,
  ) {
    return results.map(({ customerId, name, balance, status }) => ({ customerId, name, balance, status }));
  }

  /**
   * Batch-calculates the balance each customer had at the END of the given month.
   * Formula: monthEndBalance = financialBalance − sum(transactions after monthEndDate)
   * One DB query for all customers — O(1) round-trips regardless of list size.
   */
  private async getMonthEndBalanceMap(
    vendorId: string,
    customers: Array<{ id: string; financialBalance: number }>,
    endDate: Date,
  ): Promise<Map<string, number>> {
    if (customers.length === 0) return new Map();

    const laterTxs = await this.prisma.transaction.findMany({
      where: { customerId: { in: customers.map((c) => c.id) }, vendorId, createdAt: { gte: endDate } },
      select: { customerId: true, amount: true },
    });

    // Sum post-month activity per customer
    const laterByCustomer = new Map<string, number>();
    for (const tx of laterTxs) {
      laterByCustomer.set(tx.customerId, (laterByCustomer.get(tx.customerId) ?? 0) + (tx.amount ?? 0));
    }

    const result = new Map<string, number>();
    for (const c of customers) {
      result.set(c.id, c.financialBalance - (laterByCustomer.get(c.id) ?? 0));
    }
    return result;
  }

  /** Returns the first moment of the month AFTER the given YYYY-MM string (exclusive upper bound) */
  private monthEndDate(month: string): Date {
    const [year, mon] = month.split('-').map(Number);
    return new Date(year, mon, 1); // e.g. 2026-02 → 2026-03-01T00:00:00
  }

  /**
   * Send one balance reminder. With includeStatement, the monthly statement PDF
   * is generated and sent as a WhatsApp document attachment (same pattern as
   * delivery receipts). Falls back to the plain text reminder if the PDF
   * cannot be generated, so the customer still gets notified.
   */
  private async sendReminder(
    vendorId: string,
    customer: { id: string; name: string; phoneNumber: string },
    balance: number,
    month: string,
    includeStatement: boolean,
  ): Promise<boolean> {
    // Vendor master switch: statement/reminder flow can be turned off per vendor
    if (!(await this.notifSettings.isEnabled(vendorId, NotificationType.MONTHLY_STATEMENT, NotificationChannel.WHATSAPP))) {
      return false;
    }

    // Balance cleared (or in advance) — congratulate, never ask for payment
    const hasDue = balance > 0;
    const monthLabel = this.formatMonthLabel(month);

    if (includeStatement) {
      const pdf = await this.generateStatementPdf(vendorId, customer.id, month);
      if (pdf) {
        const document = { buffer: pdf.buffer, filename: pdf.filename };
        if (hasDue) {
          return this.whatsapp.sendTemplate(
            customer.phoneNumber,
            CloudTemplateNames.MONTHLY_STATEMENT,
            [customer.name, balance.toFixed(2)],
            document,
          );
        }
        if (balance < 0) {
          return this.whatsapp.sendTemplate(
            customer.phoneNumber,
            CloudTemplateNames.MONTHLY_STATEMENT_ADVANCE,
            [customer.name, monthLabel, Math.abs(balance).toFixed(2)],
            document,
          );
        }
        return this.whatsapp.sendTemplate(
          customer.phoneNumber,
          CloudTemplateNames.MONTHLY_STATEMENT_CLEAR,
          [customer.name, monthLabel],
          document,
        );
      }
    }

    if (hasDue) {
      return this.whatsapp.sendTemplate(customer.phoneNumber, CloudTemplateNames.BALANCE_REMINDER, [customer.name, balance.toFixed(2)]);
    }
    if (balance < 0) {
      return this.whatsapp.sendTemplate(customer.phoneNumber, CloudTemplateNames.BALANCE_CLEAR_ADVANCE, [customer.name, Math.abs(balance).toFixed(2)]);
    }
    return this.whatsapp.sendTemplate(customer.phoneNumber, CloudTemplateNames.BALANCE_CLEAR, [customer.name]);
  }

  /**
   * Generate the monthly statement PDF for a customer.
   * Returns null on any error so the reminder still sends as plain text.
   */
  private async generateStatementPdf(vendorId: string, customerId: string, month: string): Promise<{ buffer: Buffer; filename: string } | null> {
    try {
      const [year, mon] = month.split('-').map(Number);
      const startDate = new Date(year, mon - 1, 1);
      const endDate = this.monthEndDate(month);

      const customer = await this.prisma.customer.findFirst({ where: { id: customerId, vendorId } });
      if (!customer) return null;

      const transactions = await this.prisma.transaction.findMany({
        where: { customerId, vendorId, createdAt: { gte: startDate, lt: endDate } },
        include: {
          product: { select: { name: true } },
          dailySheetItem: { select: { bottleBalanceAfter: true } },
        },
        orderBy: { createdAt: 'asc' },
      });

      const periodActivity = transactions.reduce((sum, t) => sum + (t.amount ?? 0), 0);

      const laterTxs = await this.prisma.transaction.findMany({
        where: { customerId, vendorId, createdAt: { gte: endDate } },
        select: { amount: true },
      });
      const laterActivity = laterTxs.reduce((sum, t) => sum + (t.amount ?? 0), 0);
      const closingBalance = customer.financialBalance - laterActivity;
      const openingBalance = closingBalance - periodActivity;
      const period = new Date(year, mon - 1, 1).toLocaleString('en-PK', { month: 'long', year: 'numeric' });

      const buffer = await this.statementPdf.generate({ customer, transactions, openingBalance, closingBalance, period, month });
      // Format: customercode_shortname_month e.g. L0042_Ahmed_June_2026.pdf
      const shortName = (customer.name ?? '').trim().split(/\s+/)[0] || 'customer';
      const filename = `${this.sanitizeForFilename(customer.customerCode)}_${this.sanitizeForFilename(shortName)}_${this.sanitizeForFilename(period)}.pdf`;
      return { buffer, filename };
    } catch (err) {
      this.logger.warn(`Statement generation failed for customer ${customerId} (${month}): ${err}`);
      return null;
    }
  }

  private sanitizeForFilename(value: string | undefined | null): string {
    return (value ?? '').trim().replace(/[^a-zA-Z0-9-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
  }

  private currentMonth(): string {
    return new Date().toISOString().slice(0, 7);
  }

  private formatMonthLabel(month: string): string {
    const [year, mon] = month.split('-').map(Number);
    return new Date(year, mon - 1, 1).toLocaleString('en-PK', { month: 'long', year: 'numeric' });
  }
}
