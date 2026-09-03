import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { PrismaService } from '@water-supply-crm/database';
import { NotificationType, NotificationChannel, ReminderSendKind, PaymentRequestStatus } from '@prisma/client';
import { CloudTemplateNames } from '../whatsapp/templates/cloud-template-names';
import { isSendablePhone } from '../whatsapp/phone.util';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { NotificationSettingsService } from '../notifications/notification-settings.service';
import { CustomerStatementPdfService } from '../customer/pdf/customer-statement-pdf.service';
import { SendNowDto, SendTargetedDto, PreviewDto, SendKind, UpdateBalanceReminderConfigDto } from './dto/schedule-reminder.dto';

const DEFAULT_MIN_BALANCE = 100;
const REMINDER_COOLDOWN_TTL = 23 * 60 * 60; // 23 hours — prevent re-sending within same day
const cooldownKey = (vendorId: string, customerId: string) => `balance-reminder-cooldown:${vendorId}:${customerId}`;

// ─── Overdue-warning (Phase 2) ────────────────────────────────────────────────
const DEFAULT_WARNING_DELAY_DAYS = 3;
const WARNING_MONTH_TTL = 35 * 24 * 60 * 60; // one billing cycle + slack
/** Per-customer "already warned this billing month" marker (survives a cooldown-key expiry). */
const warningMonthKey = (vendorId: string, customerId: string, month: string) =>
  `balance-warning-sent:${vendorId}:${customerId}:${month}`;
/** A PaymentRequest in one of these states means "payment already in flight — don't nag". */
const PENDING_PAYMENT_STATES: PaymentRequestStatus[] = [PaymentRequestStatus.PENDING, PaymentRequestStatus.PROCESSING];
const DAY_MS = 24 * 60 * 60 * 1000;
const PKT_OFFSET_MS = 5 * 60 * 60 * 1000; // Asia/Karachi is UTC+5, no DST

/**
 * Pause between consecutive WhatsApp sends — avoids burst pattern that triggers
 * Meta anti-spam. Randomized per message: a fixed interval is itself a bot
 * signature, so never use a static delay.
 */
const SEND_DELAY_MIN_MS = 5000;
const SEND_DELAY_MAX_MS = 12000;

/**
 * One skip reason or the go-ahead. String values are wire-compatible with the
 * `reason` / `status` fields the preview endpoint and the reminder-send log have
 * always emitted.
 */
type SendVerdict =
  | 'would-send'
  | 'skipped-inactive'
  | 'skipped-no-phone'
  | 'skipped-invalid-phone'
  | 'skipped-new-customer'
  | 'skipped-low-balance'
  | 'skipped-cooldown'
  | 'skipped-excluded'
  // WARNING-only reasons
  | 'skipped-no-statement'
  | 'skipped-too-soon'
  | 'skipped-paid'
  | 'skipped-payment-pending'
  | 'skipped-already-warned';

/** A fetched + enriched customer, ready for classify() / runSendJob(). */
interface AudienceCandidate {
  id: string;
  name: string;
  customerCode: string;
  phoneNumber: string;
  financialBalance: number;
  monthEndBalance: number;
  isActive?: boolean; // populated for the preview phase only
  paymentType?: string; // populated for the preview phase only
  createdAt?: Date; // populated for the preview phase + eligible send
  onCooldown?: boolean; // populated when the caller asked for a batched cooldown check
  // WARNING flow only:
  lastStatementSentAt?: Date | null; // earliest 'sent' statement for this customer this month
  hasPendingPaymentRequest?: boolean;
  alreadyWarned?: boolean; // a 'sent' WARNING log exists for this customer this month
}

/** Effective overdue-warning knobs (a missing DB row yields these defaults). */
interface WarningConfig {
  warningDelayDays: number;
  warningMinBalance: number;
  autoWarningsEnabled: boolean;
}

/** Per-customer row shape returned to the caller and (minus statementUrl) persisted. */
interface ResultRow {
  customerId: string;
  name: string;
  customerCode: string;
  phone: string;
  balance: number;
  status: string;
  statementUrl?: string | null;
}

type SendMode = 'eligible' | 'single' | 'selected';

/** Result of a single message dispatch — 'sent'/'failed' as before, plus the
 *  statement-only PDF-generation miss (no plain-text fallback). */
type DispatchOutcome = 'sent' | 'failed' | 'skipped-pdf-failed';

@Injectable()
export class BalanceReminderService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BalanceReminderService.name);
  private redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly notifSettings: NotificationSettingsService,
    private readonly statementPdf: CustomerStatementPdfService,
  ) {}

  onModuleInit() {
    const redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379';
    this.redis = new Redis(redisUrl);
  }

  async onModuleDestroy() {
    await this.redis?.quit();
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
      this.resolveSendKind(dto.sendKind),
    );
  }

  /** DTO string ('reminder' | 'statement_only' | 'warning' | undefined) → persisted enum. */
  private resolveSendKind(raw?: SendKind): ReminderSendKind {
    if (raw === 'statement_only') return ReminderSendKind.STATEMENT_ONLY;
    if (raw === 'warning') return ReminderSendKind.WARNING;
    return ReminderSendKind.REMINDER;
  }

  // ─── Overdue-warning config ────────────────────────────────────────────────

  /** Effective config for a vendor. Missing row → defaults (mirrors NotificationSettings). */
  async getConfig(vendorId: string): Promise<WarningConfig> {
    const row = await this.prisma.balanceReminderConfig.findUnique({ where: { vendorId } });
    return {
      warningDelayDays: row?.warningDelayDays ?? DEFAULT_WARNING_DELAY_DAYS,
      warningMinBalance: row?.warningMinBalance ?? DEFAULT_MIN_BALANCE,
      autoWarningsEnabled: row?.autoWarningsEnabled ?? false,
    };
  }

  async updateConfig(vendorId: string, dto: UpdateBalanceReminderConfigDto): Promise<WarningConfig> {
    const data: { warningDelayDays?: number; warningMinBalance?: number } = {};
    if (dto.warningDelayDays !== undefined) data.warningDelayDays = dto.warningDelayDays;
    if (dto.warningMinBalance !== undefined) data.warningMinBalance = dto.warningMinBalance;

    await this.prisma.balanceReminderConfig.upsert({
      where: { vendorId },
      create: { vendorId, ...data },
      update: data,
    });
    return this.getConfig(vendorId);
  }

  /**
   * The instant a statement must have been sent BEFORE for a warning to be due.
   * Floored to Asia/Karachi midnight so a warning never fires a few hours "early"
   * on the boundary day — a statement is only old enough once `warningDelayDays`
   * full local days have elapsed since its calendar day.
   */
  private warningCutoff(delayDays: number, now: number = Date.now()): Date {
    const karachiMidnightUtc = Math.floor((now + PKT_OFFSET_MS) / DAY_MS) * DAY_MS - PKT_OFFSET_MS;
    return new Date(karachiMidnightUtc - delayDays * DAY_MS);
  }

  async sendTargeted(vendorId: string, dto: SendTargetedDto) {
    const kind = this.resolveSendKind(dto.sendKind);
    if (kind === ReminderSendKind.WARNING) {
      return this.sendWarnings(vendorId, dto);
    }
    const minBalance = dto.minBalance ?? DEFAULT_MIN_BALANCE;
    const dryRun = dto.dryRun ?? false;
    const force = dto.force ?? false;
    const month = dto.month ?? this.currentMonth();
    // Statement-only always attaches the PDF; otherwise honour the caller's flag.
    const includeStatement = kind === ReminderSendKind.STATEMENT_ONLY ? true : (dto.includeStatement ?? false);
    const paymentType = dto.paymentType;
    const endDate = this.monthEndDate(month);

    if (dto.mode === 'eligible') {
      return this.processVendorReminders(vendorId, minBalance, dryRun, month, includeStatement, paymentType, force, 'manual', dto.vanId, dto.dayOfWeek, dto.excludeCustomerIds, kind);
    }

    const customerIds = dto.customerIds ?? [];
    if (customerIds.length === 0) {
      return { vendorId, sent: 0, skipped: 0, dryRun, month, includeStatement, customers: [], error: 'customerIds is required for mode=single or mode=selected' };
    }

    const candidates = await this.resolveAudience({
      vendorId,
      phase: 'send',
      mode: dto.mode,
      endDate,
      customerIds,
      resolveCooldown: false,
    });

    if (candidates.length === 0) {
      return { vendorId, sent: 0, skipped: 0, dryRun, month, includeStatement, customers: [] };
    }

    const { sent, skipped, results } = await this.runSendJob({
      vendorId,
      ordered: candidates,
      mode: dto.mode,
      kind,
      minBalance,
      endDate,
      month,
      excludeIds: new Set<string>(),
      force,
      dryRun,
      includeStatement,
      dispatch: (c) => this.dispatchMessage(vendorId, c, month, kind, includeStatement),
    });

    this.logger.log(`Targeted reminders vendor=${vendorId} mode=${dto.mode} sent=${sent} skipped=${skipped} dryRun=${dryRun} force=${force} month=${month}`);

    if (!dryRun) {
      await this.prisma.reminderSendLog.create({
        data: {
          vendorId, trigger: 'manual', mode: dto.mode, kind, month, sent, skipped, includeStatement, dryRun,
          force,
          details: this.toLogDetails(results),
        },
      });
    }

    return { vendorId, sent, skipped, dryRun, month, includeStatement, customers: results };
  }

  async previewReminders(vendorId: string, dto: PreviewDto) {
    const kind = this.resolveSendKind(dto.sendKind);
    const month = dto.month ?? this.currentMonth();
    const endDate = this.monthEndDate(month);

    if (kind === ReminderSendKind.WARNING) {
      return this.previewWarnings(vendorId, dto, month, endDate);
    }

    const minBalance = dto.minBalance ?? DEFAULT_MIN_BALANCE;
    const mode = dto.mode ?? 'eligible';
    const includeStatement = kind === ReminderSendKind.STATEMENT_ONLY ? true : (dto.includeStatement ?? false);
    const paymentType = dto.paymentType;

    const candidates = await this.resolveAudience({
      vendorId,
      phase: 'preview',
      mode,
      endDate,
      paymentType,
      vanId: dto.vanId,
      dayOfWeek: dto.dayOfWeek,
      customerIds: dto.customerIds,
      resolveCooldown: true,
    });

    type PreviewEntry = { customerId: string; name: string; customerCode: string; balance: number; phone: string; paymentType: string; reason: string };
    const wouldSend: PreviewEntry[] = [];
    const skipped: PreviewEntry[] = [];

    for (const c of candidates) {
      const verdict = this.classify(c, {
        phase: 'preview',
        mode,
        kind,
        minBalance,
        endDate,
        excludeIds: new Set<string>(),
        onCooldown: c.onCooldown ?? false,
      });
      const entry: PreviewEntry = {
        customerId: c.id,
        name: c.name,
        customerCode: c.customerCode,
        balance: c.monthEndBalance,
        phone: c.phoneNumber,
        paymentType: c.paymentType as string,
        reason: verdict,
      };
      (verdict === 'would-send' ? wouldSend : skipped).push(entry);
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
    kind: ReminderSendKind = ReminderSendKind.REMINDER,
  ) {
    const targetMonth = month ?? this.currentMonth();

    // WARNING is not an all-customers scan — it needs the statement-log join.
    // Route it to the dedicated path (covers sendNow and any direct caller).
    if (kind === ReminderSendKind.WARNING) {
      return this.sendWarnings(vendorId, {
        sendKind: 'warning', mode: 'eligible', month: targetMonth, dryRun, force, excludeCustomerIds,
      } as SendTargetedDto);
    }

    const endDate = this.monthEndDate(targetMonth);
    const excludeSet = new Set(excludeCustomerIds ?? []);
    const isStatementOnly = kind === ReminderSendKind.STATEMENT_ONLY;
    // Statement-only always attaches the PDF; otherwise honour the caller's flag.
    const effectiveIncludeStatement = isStatementOnly ? true : includeStatement;

    // Fetch all active candidates with phone — do NOT filter by balance at DB level
    // because we need month-end balance (historical), not today's live balance.
    const candidates = await this.resolveAudience({
      vendorId,
      phase: 'send',
      mode: 'eligible',
      endDate,
      paymentType,
      vanId,
      dayOfWeek,
      resolveCooldown: false,
    });

    if (candidates.length === 0) {
      this.logger.log(`No active customers with phone for vendor ${vendorId}`);
      return { vendorId, sent: 0, skipped: 0, dryRun, month: targetMonth, includeStatement: effectiveIncludeStatement, paymentType: paymentType ?? 'BOTH', customers: [] };
    }

    // REMINDER: filter to those with month-end balance >= minBalance (pre-loop, exactly
    // as before — low-balance customers never enter the result set or the skipped count).
    // STATEMENT_ONLY: no balance threshold at all — everyone selected gets a statement.
    const eligible = isStatementOnly ? candidates : candidates.filter((c) => c.monthEndBalance >= minBalance);

    if (eligible.length === 0) {
      this.logger.log(
        isStatementOnly
          ? `No eligible customers for statement-only send for vendor ${vendorId} (${targetMonth})`
          : `No customers with month-end balance >= ${minBalance} for vendor ${vendorId} (${targetMonth})`,
      );
      return { vendorId, sent: 0, skipped: 0, dryRun, month: targetMonth, includeStatement: effectiveIncludeStatement, paymentType: paymentType ?? 'BOTH', customers: [] };
    }

    const { sent, skipped, results } = await this.runSendJob({
      vendorId,
      ordered: eligible,
      mode: 'eligible',
      kind,
      minBalance,
      endDate,
      month: targetMonth,
      excludeIds: excludeSet,
      force,
      dryRun,
      includeStatement: effectiveIncludeStatement,
      dispatch: (c) => this.dispatchMessage(vendorId, c, targetMonth, kind, effectiveIncludeStatement),
    });

    this.logger.log(`Balance reminders vendor=${vendorId} sent=${sent} skipped=${skipped} dryRun=${dryRun} force=${force} month=${targetMonth} includeStatement=${effectiveIncludeStatement}`);

    if (!dryRun) {
      await this.prisma.reminderSendLog.create({
        data: {
          vendorId, trigger, mode: 'eligible', kind, month: targetMonth, sent, skipped, includeStatement: effectiveIncludeStatement, dryRun,
          minBalance,
          paymentType: paymentType ?? null,
          vanId: vanId ?? null,
          dayOfWeek: dayOfWeek ?? null,
          force,
          details: this.toLogDetails(results),
        },
      });
    }

    return { vendorId, sent, skipped, dryRun, month: targetMonth, includeStatement: effectiveIncludeStatement, paymentType: paymentType ?? 'BOTH', customers: results };
  }

  // ─── Shared send pipeline (Phase 0 refactor) ────────────────────────────────

  /**
   * Fetch + enrich the candidate list. Fetching / enrichment ONLY — every
   * eligibility decision lives in classify(). Each branch mirrors, field for
   * field, the query that used to be inline in previewReminders /
   * processVendorReminders / sendTargeted:
   *
   *  - preview:            no isActive / phone DB filter (classify reports
   *                        skipped-inactive / skipped-no-phone), selects
   *                        isActive + paymentType + createdAt, ordered by balance.
   *  - send / eligible:    DB-filters isActive + phoneNumber != '', selects
   *                        createdAt, ordered by balance.
   *  - send / single|selected: DB-filters isActive + phoneNumber != '' by id list,
   *                        no createdAt, no ordering.
   *
   * Cooldown is resolved here (one batched pipeline) only when asked — the send
   * loop re-checks it live, per customer, at the right moment instead.
   */
  private async resolveAudience(opts: {
    vendorId: string;
    phase: 'preview' | 'send';
    mode: SendMode;
    endDate: Date;
    paymentType?: 'MONTHLY' | 'CASH';
    vanId?: string;
    dayOfWeek?: number;
    customerIds?: string[];
    resolveCooldown: boolean;
  }): Promise<AudienceCandidate[]> {
    const { vendorId } = opts;

    let rows: Array<{
      id: string;
      name: string;
      customerCode: string;
      phoneNumber: string;
      financialBalance: number;
      isActive?: boolean;
      paymentType?: string;
      createdAt?: Date;
    }>;

    if (opts.phase === 'preview') {
      const whereBase = opts.mode === 'eligible'
        ? { vendorId, ...(opts.paymentType ? { paymentType: opts.paymentType } : {}), ...this.scheduleFilter(opts.vanId, opts.dayOfWeek) }
        : { id: { in: opts.customerIds ?? [] }, vendorId };
      rows = await this.prisma.customer.findMany({
        where: whereBase,
        select: { id: true, name: true, customerCode: true, phoneNumber: true, financialBalance: true, isActive: true, paymentType: true, createdAt: true },
        orderBy: { financialBalance: 'desc' },
      });
    } else if (opts.mode === 'eligible') {
      rows = await this.prisma.customer.findMany({
        where: {
          vendorId,
          ...(opts.paymentType ? { paymentType: opts.paymentType } : {}),
          ...this.scheduleFilter(opts.vanId, opts.dayOfWeek),
          isActive: true,
          phoneNumber: { not: '' },
        },
        select: { id: true, name: true, customerCode: true, phoneNumber: true, financialBalance: true, createdAt: true },
        orderBy: { financialBalance: 'desc' },
      });
    } else {
      rows = await this.prisma.customer.findMany({
        where: { id: { in: opts.customerIds ?? [] }, vendorId, isActive: true, phoneNumber: { not: '' } },
        select: { id: true, name: true, customerCode: true, phoneNumber: true, financialBalance: true },
      });
    }

    const monthEndBalances = await this.getMonthEndBalanceMap(
      vendorId,
      rows as Array<{ id: string; financialBalance: number }>,
      opts.endDate,
    );

    let onCooldownSet = new Set<string>();
    if (opts.resolveCooldown) {
      const pipeline = this.redis.pipeline();
      for (const c of rows) pipeline.exists(cooldownKey(vendorId, c.id));
      const cooldownResults = await pipeline.exec();
      onCooldownSet = new Set<string>(
        rows.filter((_, i) => (cooldownResults?.[i]?.[1] as number) === 1).map((c) => c.id),
      );
    }

    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      customerCode: c.customerCode,
      phoneNumber: c.phoneNumber,
      financialBalance: c.financialBalance,
      monthEndBalance: monthEndBalances.get(c.id) ?? c.financialBalance,
      isActive: c.isActive,
      paymentType: c.paymentType,
      createdAt: c.createdAt,
      onCooldown: opts.resolveCooldown ? onCooldownSet.has(c.id) : undefined,
    }));
  }

  // ─── Overdue-warning flow (Phase 2) ───────────────────────────────────────

  /**
   * Fetch + enrich the overdue-warning audience — fetching / enrichment ONLY,
   * every decision is classifyWarning()'s. Steps:
   *  1. this month's *statement* sends (STATEMENT_ONLY, or REMINDER+includeStatement),
   *     dryRun=false → per-customer earliest 'sent' timestamp.
   *  2. this month's WARNING sends (dryRun=false) → per-customer "already warned" set.
   *  3. load those customers (active, phoned, NOT billing-exempt) + live balance +
   *     any pending PaymentRequest.
   *  4. redis-batch the "already warned this month" marker (belt-and-braces vs the log).
   */
  private async resolveWarningAudience(opts: {
    vendorId: string;
    phase: 'preview' | 'send';
    month: string;
    endDate: Date;
    customerIds?: string[]; // set when mode is single/selected
    paymentType?: 'MONTHLY' | 'CASH';
    vanId?: string;
    dayOfWeek?: number;
    resolveCooldown: boolean;
  }): Promise<AudienceCandidate[]> {
    const { vendorId, month } = opts;

    const statementLogs = await this.prisma.reminderSendLog.findMany({
      where: {
        vendorId,
        month,
        dryRun: false,
        OR: [
          { kind: ReminderSendKind.STATEMENT_ONLY },
          { kind: ReminderSendKind.REMINDER, includeStatement: true },
        ],
      },
      select: { createdAt: true, details: true },
      orderBy: { createdAt: 'asc' },
    });

    const sentStatementAt = new Map<string, Date>();
    for (const log of statementLogs) {
      const details = Array.isArray(log.details) ? (log.details as Array<{ customerId?: string; status?: string }>) : [];
      for (const d of details) {
        if (d?.status === 'sent' && d.customerId) {
          const existing = sentStatementAt.get(d.customerId);
          if (!existing || log.createdAt < existing) sentStatementAt.set(d.customerId, log.createdAt);
        }
      }
    }

    let statementCustomerIds = [...sentStatementAt.keys()];
    if (opts.customerIds) {
      const wanted = new Set(opts.customerIds);
      statementCustomerIds = statementCustomerIds.filter((id) => wanted.has(id));
    }
    if (statementCustomerIds.length === 0) return [];

    const warnLogs = await this.prisma.reminderSendLog.findMany({
      where: { vendorId, month, kind: ReminderSendKind.WARNING, dryRun: false },
      select: { details: true },
    });
    const warnedInLog = new Set<string>();
    for (const log of warnLogs) {
      const details = Array.isArray(log.details) ? (log.details as Array<{ customerId?: string; status?: string }>) : [];
      for (const d of details) {
        if (d?.status === 'sent' && d.customerId) warnedInLog.add(d.customerId);
      }
    }

    const rows = await this.prisma.customer.findMany({
      where: {
        id: { in: statementCustomerIds },
        vendorId,
        isActive: true,
        isBillingExempt: false,
        phoneNumber: { not: '' },
        ...(opts.paymentType ? { paymentType: opts.paymentType } : {}),
        ...this.scheduleFilter(opts.vanId, opts.dayOfWeek),
      },
      select: {
        id: true, name: true, customerCode: true, phoneNumber: true, financialBalance: true,
        paymentType: true, createdAt: true,
        paymentRequests: { where: { status: { in: PENDING_PAYMENT_STATES } }, select: { id: true }, take: 1 },
      },
    });

    let warnedInRedis = new Set<string>();
    if (rows.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const c of rows) pipeline.exists(warningMonthKey(vendorId, c.id, month));
      const res = await pipeline.exec();
      warnedInRedis = new Set<string>(rows.filter((_, i) => (res?.[i]?.[1] as number) === 1).map((c) => c.id));
    }

    let onCooldownSet = new Set<string>();
    if (opts.resolveCooldown && rows.length > 0) {
      const pipeline = this.redis.pipeline();
      for (const c of rows) pipeline.exists(cooldownKey(vendorId, c.id));
      const res = await pipeline.exec();
      onCooldownSet = new Set<string>(rows.filter((_, i) => (res?.[i]?.[1] as number) === 1).map((c) => c.id));
    }

    return rows.map((c) => ({
      id: c.id,
      name: c.name,
      customerCode: c.customerCode,
      phoneNumber: c.phoneNumber,
      financialBalance: c.financialBalance,
      monthEndBalance: c.financialBalance, // WARNING judges the LIVE balance
      isActive: true,
      paymentType: c.paymentType,
      createdAt: c.createdAt,
      lastStatementSentAt: sentStatementAt.get(c.id) ?? null,
      hasPendingPaymentRequest: (c.paymentRequests?.length ?? 0) > 0,
      alreadyWarned: warnedInLog.has(c.id) || warnedInRedis.has(c.id),
      onCooldown: opts.resolveCooldown ? onCooldownSet.has(c.id) : undefined,
    }));
  }

  private async previewWarnings(vendorId: string, dto: PreviewDto, month: string, endDate: Date) {
    const config = await this.getConfig(vendorId);
    const cutoff = this.warningCutoff(config.warningDelayDays);
    const mode = dto.mode ?? 'eligible';
    const isEligible = mode === 'eligible';
    const scopedIds = isEligible ? undefined : (dto.customerIds ?? []);

    const candidates = await this.resolveWarningAudience({
      vendorId, phase: 'preview', month, endDate, customerIds: scopedIds,
      // audience filters only narrow the eligible (whole-vendor) scan
      paymentType: isEligible ? dto.paymentType : undefined,
      vanId: isEligible ? dto.vanId : undefined,
      dayOfWeek: isEligible ? dto.dayOfWeek : undefined,
      resolveCooldown: true,
    });

    type PreviewEntry = { customerId: string; name: string; customerCode: string; balance: number; phone: string; paymentType: string; reason: string };
    const wouldSend: PreviewEntry[] = [];
    const skipped: PreviewEntry[] = [];

    for (const c of candidates) {
      const verdict = this.classify(c, {
        phase: 'preview', mode, kind: ReminderSendKind.WARNING,
        minBalance: config.warningMinBalance, endDate,
        excludeIds: new Set<string>(), onCooldown: c.onCooldown ?? false, warningCutoff: cutoff,
      });
      const entry: PreviewEntry = {
        customerId: c.id, name: c.name, customerCode: c.customerCode,
        balance: c.financialBalance, phone: c.phoneNumber, paymentType: (c.paymentType as string) ?? '',
        reason: verdict,
      };
      (verdict === 'would-send' ? wouldSend : skipped).push(entry);
    }

    return {
      vendorId, mode, kind: 'WARNING', minBalance: config.warningMinBalance, month,
      includeStatement: false, paymentType: (isEligible ? dto.paymentType : undefined) ?? 'BOTH',
      warningDelayDays: config.warningDelayDays,
      totalWouldSend: wouldSend.length, totalSkipped: skipped.length, wouldSend, skipped,
    };
  }

  private async sendWarnings(vendorId: string, dto: SendTargetedDto) {
    const config = await this.getConfig(vendorId);
    const dryRun = dto.dryRun ?? false;
    const force = dto.force ?? false;
    const month = dto.month ?? this.currentMonth();
    const endDate = this.monthEndDate(month);
    const cutoff = this.warningCutoff(config.warningDelayDays);
    const isEligible = dto.mode === 'eligible';
    const scopedIds = isEligible ? undefined : (dto.customerIds ?? []);

    if (!isEligible && scopedIds!.length === 0) {
      return { vendorId, sent: 0, skipped: 0, dryRun, month, includeStatement: false, customers: [], error: 'customerIds is required for mode=single or mode=selected' };
    }

    const candidates = await this.resolveWarningAudience({
      vendorId, phase: 'send', month, endDate, customerIds: scopedIds,
      // audience filters only narrow the eligible (whole-vendor) scan
      paymentType: isEligible ? dto.paymentType : undefined,
      vanId: isEligible ? dto.vanId : undefined,
      dayOfWeek: isEligible ? dto.dayOfWeek : undefined,
      resolveCooldown: false,
    });

    if (candidates.length === 0) {
      return { vendorId, sent: 0, skipped: 0, dryRun, month, includeStatement: false, customers: [] };
    }

    const { sent, skipped, results } = await this.runSendJob({
      vendorId,
      ordered: candidates,
      mode: dto.mode,
      kind: ReminderSendKind.WARNING,
      minBalance: config.warningMinBalance,
      endDate,
      month,
      excludeIds: new Set(dto.excludeCustomerIds ?? []),
      force,
      dryRun,
      includeStatement: false,
      warningCutoff: cutoff,
      dispatch: (c) => this.dispatchMessage(vendorId, c, month, ReminderSendKind.WARNING, false),
    });

    this.logger.log(`Overdue warnings vendor=${vendorId} mode=${dto.mode} sent=${sent} skipped=${skipped} dryRun=${dryRun} force=${force} month=${month}`);

    if (!dryRun) {
      await this.prisma.reminderSendLog.create({
        data: {
          vendorId, trigger: 'manual', mode: dto.mode, kind: ReminderSendKind.WARNING, month,
          sent, skipped, includeStatement: false, dryRun, force,
          minBalance: config.warningMinBalance,
          paymentType: isEligible ? (dto.paymentType ?? null) : null,
          vanId: isEligible ? (dto.vanId ?? null) : null,
          dayOfWeek: isEligible ? (dto.dayOfWeek ?? null) : null,
          details: this.toLogDetails(results),
        },
      });
    }

    return { vendorId, sent, skipped, dryRun, month, includeStatement: false, customers: results };
  }

  /**
   * Pure eligibility decision — no I/O, and nothing about WhatsApp templates or
   * dispatch. Reproduces exactly the skip ladders that were previously inline:
   *
   *  - phase 'preview'          → inactive → no-phone → invalid-phone →
   *                               new-customer → low-balance → cooldown
   *  - phase 'send', eligible   → new-customer → excluded → invalid-phone
   *                               (low-balance is pre-filtered by the caller;
   *                               cooldown is applied by runSendJob, positionally,
   *                               after the dry-run / connectivity checks)
   *  - phase 'send', single/selected → invalid-phone
   *
   * STATEMENT_ONLY drops the low-balance rung only (a statement is sent whatever
   * the balance). Every other rung is unchanged.
   *
   * WARNING uses its own ladder (classifyWarning) — its audience is already
   * DB-filtered to active / phoned / non-exempt statement recipients, so the
   * remaining rungs are all warning-specific.
   */
  private classify(
    c: Pick<
      AudienceCandidate,
      'id' | 'phoneNumber' | 'monthEndBalance' | 'financialBalance' | 'isActive' | 'createdAt'
      | 'lastStatementSentAt' | 'hasPendingPaymentRequest' | 'alreadyWarned'
    >,
    ctx: {
      phase: 'preview' | 'send';
      mode: SendMode;
      kind: ReminderSendKind;
      minBalance: number;
      endDate: Date;
      excludeIds: Set<string>;
      onCooldown: boolean;
      warningCutoff?: Date;
    },
  ): SendVerdict {
    if (ctx.kind === ReminderSendKind.WARNING) {
      return this.classifyWarning(c, ctx);
    }

    const enforceMinBalance = ctx.kind !== ReminderSendKind.STATEMENT_ONLY;

    if (ctx.phase === 'preview') {
      if (!c.isActive) return 'skipped-inactive';
      if (!c.phoneNumber || c.phoneNumber.trim() === '') return 'skipped-no-phone';
      if (!this.isValidPhone(c.phoneNumber)) return 'skipped-invalid-phone';
      if (c.createdAt && c.createdAt >= ctx.endDate) return 'skipped-new-customer';
      if (enforceMinBalance && c.monthEndBalance < ctx.minBalance) return 'skipped-low-balance';
      if (ctx.onCooldown) return 'skipped-cooldown';
      return 'would-send';
    }

    if (ctx.mode === 'eligible') {
      if (c.createdAt && c.createdAt >= ctx.endDate) return 'skipped-new-customer';
      if (ctx.excludeIds.has(c.id)) return 'skipped-excluded';
      if (!this.isValidPhone(c.phoneNumber)) return 'skipped-invalid-phone';
      return 'would-send';
    }

    // single | selected
    if (!this.isValidPhone(c.phoneNumber)) return 'skipped-invalid-phone';
    return 'would-send';
  }

  /**
   * Overdue-warning ladder. `ctx.minBalance` here is the vendor's
   * `warningMinBalance` and the balance checked is the LIVE `financialBalance`
   * (the point is "did they pay since the statement"). Cooldown is only a
   * preview-phase rung — the send loop applies it positionally.
   */
  private classifyWarning(
    c: Pick<
      AudienceCandidate,
      'id' | 'phoneNumber' | 'financialBalance' | 'createdAt'
      | 'lastStatementSentAt' | 'hasPendingPaymentRequest' | 'alreadyWarned' | 'onCooldown'
    >,
    ctx: { phase: 'preview' | 'send'; minBalance: number; endDate: Date; excludeIds: Set<string>; warningCutoff?: Date },
  ): SendVerdict {
    if (c.createdAt && c.createdAt >= ctx.endDate) return 'skipped-new-customer';
    if (ctx.excludeIds.has(c.id)) return 'skipped-excluded';
    if (!this.isValidPhone(c.phoneNumber)) return 'skipped-invalid-phone';
    if (!c.lastStatementSentAt) return 'skipped-no-statement';
    if (ctx.warningCutoff && c.lastStatementSentAt >= ctx.warningCutoff) return 'skipped-too-soon';
    if (c.financialBalance < ctx.minBalance) return 'skipped-paid';
    if (c.hasPendingPaymentRequest) return 'skipped-payment-pending';
    if (c.alreadyWarned) return 'skipped-already-warned';
    if (ctx.phase === 'preview' && c.onCooldown) return 'skipped-cooldown';
    return 'would-send';
  }

  /**
   * The shared send loop — previously duplicated as the eligible loop in
   * processVendorReminders and the single/selected loop in sendTargeted.
   * Order is preserved exactly:
   *   classify() rungs → dry-run short-circuit → connectivity abort (mark the
   *   current customer and every one after it 'skipped-disconnected', then stop)
   *   → per-customer cooldown (unless force) → dispatch → cooldown SET on success
   *   → randomized sendDelay() between customers, never after the last.
   */
  private async runSendJob(opts: {
    vendorId: string;
    ordered: AudienceCandidate[];
    mode: SendMode;
    kind: ReminderSendKind;
    minBalance: number;
    endDate: Date;
    month: string;
    excludeIds: Set<string>;
    force: boolean;
    dryRun: boolean;
    includeStatement: boolean;
    warningCutoff?: Date;
    dispatch: (c: AudienceCandidate) => Promise<DispatchOutcome>;
  }): Promise<{ sent: number; skipped: number; results: ResultRow[] }> {
    let sent = 0;
    let skipped = 0;
    const results: ResultRow[] = [];

    for (let i = 0; i < opts.ordered.length; i++) {
      const customer = opts.ordered[i];
      const monthBalance = customer.monthEndBalance;

      const verdict = this.classify(customer, {
        phase: 'send',
        mode: opts.mode,
        kind: opts.kind,
        minBalance: opts.minBalance,
        endDate: opts.endDate,
        excludeIds: opts.excludeIds,
        onCooldown: false,
        warningCutoff: opts.warningCutoff,
      });
      if (verdict !== 'would-send') {
        results.push(this.resultRow(customer, monthBalance, verdict));
        skipped++;
        continue;
      }

      if (opts.dryRun) {
        results.push(this.resultRow(customer, monthBalance, 'would-send', opts.includeStatement));
        skipped++;
        continue;
      }

      // WhatsApp dropped mid-batch — abort instead of burning 5s per remaining customer
      if (!this.whatsapp.isReady()) {
        this.logger.warn(`WhatsApp disconnected mid-batch — aborting, ${opts.ordered.length - i} customers remaining`);
        for (let j = i; j < opts.ordered.length; j++) {
          const c = opts.ordered[j];
          results.push(this.resultRow(c, c.monthEndBalance, 'skipped-disconnected'));
          skipped++;
        }
        break;
      }

      // Enforce per-customer cooldown unless force=true
      if (!opts.force) {
        const onCooldown = await this.redis.exists(cooldownKey(opts.vendorId, customer.id));
        if (onCooldown) {
          results.push(this.resultRow(customer, monthBalance, 'skipped-cooldown'));
          skipped++;
          continue;
        }
      }

      const outcome = await opts.dispatch(customer);
      if (outcome === 'sent') {
        await this.redis.set(cooldownKey(opts.vendorId, customer.id), '1', 'EX', REMINDER_COOLDOWN_TTL);
        if (opts.kind === ReminderSendKind.WARNING) {
          await this.redis.set(warningMonthKey(opts.vendorId, customer.id, opts.month), '1', 'EX', WARNING_MONTH_TTL);
        }
        sent++;
      } else {
        skipped++;
      }
      results.push(this.resultRow(customer, monthBalance, outcome));

      if (i < opts.ordered.length - 1) {
        await this.sendDelay();
      }
    }

    return { sent, skipped, results };
  }

  /**
   * Build a per-customer result row — same shape the send loops always produced:
   * every row carries a `statementUrl` key; only the 'would-send' row fills it
   * with the PDF hint (and only when includeStatement is set), every other row
   * (sent / failed / skipped-*) carries an explicit null.
   */
  private resultRow(
    c: { id: string; name: string; customerCode: string; phoneNumber: string },
    balance: number,
    status: string,
    includeStatement?: boolean,
  ): ResultRow {
    return {
      customerId: c.id,
      name: c.name,
      customerCode: c.customerCode,
      phone: c.phoneNumber,
      balance,
      status,
      statementUrl: status === 'would-send' ? (includeStatement ? '(statement PDF attached at send time)' : null) : null,
    };
  }

  // ─── History ────────────────────────────────────────────────────────────────

  async getSendHistory(
    vendorId: string,
    page: number,
    limit: number,
    filters?: { dateFrom?: string; dateTo?: string; result?: string; kind?: ReminderSendKind | string },
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

    // kind filter: 'REMINDER' | 'STATEMENT_ONLY' | 'WARNING'
    if (filters?.kind) where.kind = filters.kind;

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
    results: Array<{ customerId: string; name: string; customerCode: string; phone: string; balance: number; status: string }>,
  ) {
    return results.map(({ customerId, name, customerCode, phone, balance, status }) => ({ customerId, name, customerCode, phone, balance, status }));
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
   * Single entry point for actually sending a customer's message. Picks the
   * message by kind; this is the ONLY place a template name is chosen for a
   * send. classify()/runSendJob() stay message-agnostic.
   */
  private async dispatchMessage(
    vendorId: string,
    customer: AudienceCandidate,
    month: string,
    kind: ReminderSendKind,
    includeStatement: boolean,
  ): Promise<DispatchOutcome> {
    if (kind === ReminderSendKind.STATEMENT_ONLY) {
      return this.sendStatementOnly(vendorId, customer, month);
    }
    if (kind === ReminderSendKind.WARNING) {
      return this.sendWarning(vendorId, customer);
    }
    const ok = await this.sendReminder(vendorId, customer, customer.monthEndBalance, month, includeStatement);
    return ok ? 'sent' : 'failed';
  }

  /**
   * Overdue-warning send — the factual `payment_overdue_warning` text template
   * with the customer's LIVE outstanding balance. No PDF. Gated by its own
   * vendor master switch (PAYMENT_WARNING) so statements can stay on with
   * warnings off.
   */
  private async sendWarning(
    vendorId: string,
    customer: { name: string; phoneNumber: string; financialBalance: number },
  ): Promise<DispatchOutcome> {
    if (!(await this.notifSettings.isEnabled(vendorId, NotificationType.PAYMENT_WARNING, NotificationChannel.WHATSAPP))) {
      return 'failed';
    }
    const ok = await this.whatsapp.sendTemplate(
      customer.phoneNumber,
      CloudTemplateNames.PAYMENT_OVERDUE_WARNING,
      [customer.name, customer.financialBalance.toFixed(2)],
    );
    return ok ? 'sent' : 'failed';
  }

  /**
   * "Statement only" send — the neutral monthly-statement template with the PDF
   * attached, no balance / payment wording. No plain-text fallback: if the PDF
   * cannot be generated the customer is skipped ('skipped-pdf-failed').
   * Same vendor master switch as the reminder flow (MONTHLY_STATEMENT).
   */
  private async sendStatementOnly(
    vendorId: string,
    customer: { id: string; name: string; phoneNumber: string },
    month: string,
  ): Promise<DispatchOutcome> {
    if (!(await this.notifSettings.isEnabled(vendorId, NotificationType.MONTHLY_STATEMENT, NotificationChannel.WHATSAPP))) {
      return 'failed';
    }

    const pdf = await this.generateStatementPdf(vendorId, customer.id, month);
    if (!pdf) return 'skipped-pdf-failed';

    const sent = await this.whatsapp.sendTemplate(
      customer.phoneNumber,
      CloudTemplateNames.MONTHLY_STATEMENT_NEUTRAL,
      [customer.name, this.formatMonthLabel(month)],
      { buffer: pdf.buffer, filename: pdf.filename },
    );
    return sent ? 'sent' : 'failed';
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
