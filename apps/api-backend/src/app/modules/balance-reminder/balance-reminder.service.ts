import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { MessageTemplates } from '../whatsapp/templates/message.templates';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { StorageService } from '../../common/storage/storage.service';
import { CustomerStatementPdfService } from '../customer/pdf/customer-statement-pdf.service';
import { ScheduleReminderDto, SendNowDto, SendTargetedDto, PreviewDto } from './dto/schedule-reminder.dto';

const DEFAULT_CRON = '0 4 * * *'; // 9 AM PKT (UTC+5) — stored as UTC
const DEFAULT_MIN_BALANCE = 100;
const REPEATABLE_JOB_ID = (vendorId: string) => `balance-reminder:${vendorId}`;

/** Signed statement URL is valid for 7 days — long enough for customer to act */
const STATEMENT_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Stable response shape returned by all schedule-related endpoints */
export interface ReminderScheduleStatus {
  vendorId: string;
  scheduled: boolean;
  cronExpression: string | null;
  minBalance: number | null;
  nextRunAt: string | null;
}

@Injectable()
export class BalanceReminderService {
  private readonly logger = new Logger(BalanceReminderService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.BALANCE_REMINDERS)
    private readonly reminderQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
    private readonly storage: StorageService,
    private readonly statementPdf: CustomerStatementPdfService,
  ) {}

  // ─── Schedule management ────────────────────────────────────────────────────

  private async removeQueueJob(vendorId: string): Promise<void> {
    const jobId = REPEATABLE_JOB_ID(vendorId);
    const repeatableJobs = await this.reminderQueue.getRepeatableJobs();
    for (const job of repeatableJobs.filter((j) => j.id === jobId)) {
      await this.reminderQueue.removeRepeatableByKey(job.key);
    }
  }

  async scheduleReminders(
    vendorId: string,
    dto: ScheduleReminderDto,
  ): Promise<ReminderScheduleStatus & { message: string }> {
    const cronExpression = dto.cronExpression ?? DEFAULT_CRON;
    const minBalance = dto.minBalance ?? DEFAULT_MIN_BALANCE;
    const jobId = REPEATABLE_JOB_ID(vendorId);

    await this.removeQueueJob(vendorId);
    await this.reminderQueue.add(
      JOB_NAMES.SEND_BALANCE_REMINDERS,
      { vendorId, minBalance },
      { repeat: { pattern: cronExpression, utc: true }, jobId, removeOnComplete: 50, removeOnFail: 20 },
    );

    await this.prisma.reminderScheduleConfig.upsert({
      where: { vendorId },
      update: { cronExpression, minBalance },
      create: { vendorId, cronExpression, minBalance },
    });

    const repeatableJobs = await this.reminderQueue.getRepeatableJobs();
    const job = repeatableJobs.find((j) => j.id === jobId);
    const nextRunAt = job?.next ? new Date(job.next).toISOString() : null;

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
    const repeatableJobs = await this.reminderQueue.getRepeatableJobs();
    const job = repeatableJobs.find((j) => j.id === jobId);
    const nextRunAt = job?.next ? new Date(job.next).toISOString() : null;

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
    );
  }

  async sendTargeted(vendorId: string, dto: SendTargetedDto) {
    const minBalance = dto.minBalance ?? DEFAULT_MIN_BALANCE;
    const dryRun = dto.dryRun ?? false;
    const month = dto.month ?? this.currentMonth();
    const includeStatement = dto.includeStatement ?? false;
    const paymentType = dto.paymentType;
    const endDate = this.monthEndDate(month);

    if (dto.mode === 'eligible') {
      return this.processVendorReminders(vendorId, minBalance, dryRun, month, includeStatement, paymentType);
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

    for (const customer of customers) {
      const monthBalance = monthEndBalances.get(customer.id) ?? customer.financialBalance;
      let statementUrl: string | null = null;

      if (includeStatement && !dryRun) {
        statementUrl = await this.generateStatementUrl(vendorId, customer.id, month);
      }

      const message = statementUrl
        ? MessageTemplates.balanceReminderWithStatement(customer.name, monthBalance, this.formatMonthLabel(month), statementUrl)
        : MessageTemplates.balanceReminder(customer.name, monthBalance);

      if (dryRun) {
        results.push({ customerId: customer.id, name: customer.name, balance: monthBalance, status: 'would-send', statementUrl: includeStatement ? '(signed URL generated at send time)' : null });
        skipped++;
        continue;
      }

      const messageSent = await this.whatsapp.sendMessage(customer.phoneNumber, message);
      results.push({ customerId: customer.id, name: customer.name, balance: monthBalance, status: messageSent ? 'sent' : 'failed', statementUrl });
      if (messageSent) { sent++; } else { skipped++; }
    }

    this.logger.log(`Targeted reminders vendor=${vendorId} mode=${dto.mode} sent=${sent} skipped=${skipped} dryRun=${dryRun} month=${month}`);
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
      ? { vendorId, ...(paymentType ? { paymentType } : {}) }
      : { id: { in: dto.customerIds ?? [] }, vendorId };

    const candidates = await this.prisma.customer.findMany({
      where: whereBase,
      select: { id: true, name: true, phoneNumber: true, financialBalance: true, isActive: true, paymentType: true },
      orderBy: { financialBalance: 'desc' },
    });

    // One batch query: get all transactions after month-end for all candidates
    const monthEndBalances = await this.getMonthEndBalanceMap(vendorId, candidates, endDate);

    type PreviewEntry = { customerId: string; name: string; balance: number; phone: string; paymentType: string; reason: string };
    const wouldSend: PreviewEntry[] = [];
    const skipped: PreviewEntry[] = [];

    for (const c of candidates) {
      const monthBalance = monthEndBalances.get(c.id) ?? c.financialBalance;
      const entry: PreviewEntry = { customerId: c.id, name: c.name, balance: monthBalance, phone: c.phoneNumber, paymentType: c.paymentType, reason: '' };

      if (!c.isActive) {
        entry.reason = 'skipped-inactive';
        skipped.push(entry);
      } else if (!c.phoneNumber || c.phoneNumber.trim() === '') {
        entry.reason = 'skipped-no-phone';
        skipped.push(entry);
      } else if (monthBalance < minBalance) {
        entry.reason = 'skipped-low-balance';
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
  ) {
    const targetMonth = month ?? this.currentMonth();
    const endDate = this.monthEndDate(targetMonth);

    // Fetch all active candidates with phone — do NOT filter by balance at DB level
    // because we need month-end balance (historical), not today's live balance.
    const candidates = await this.prisma.customer.findMany({
      where: {
        vendorId,
        ...(paymentType ? { paymentType } : {}),
        isActive: true,
        phoneNumber: { not: '' },
      },
      select: { id: true, name: true, phoneNumber: true, financialBalance: true },
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

    for (const customer of eligible) {
      const monthBalance = monthEndBalances.get(customer.id) ?? customer.financialBalance;
      let statementUrl: string | null = null;

      if (includeStatement && !dryRun) {
        statementUrl = await this.generateStatementUrl(vendorId, customer.id, targetMonth);
      }

      const message = statementUrl
        ? MessageTemplates.balanceReminderWithStatement(customer.name, monthBalance, this.formatMonthLabel(targetMonth), statementUrl)
        : MessageTemplates.balanceReminder(customer.name, monthBalance);

      if (dryRun) {
        results.push({ customerId: customer.id, name: customer.name, balance: monthBalance, status: 'would-send', statementUrl: includeStatement ? '(signed URL generated at send time)' : null });
        skipped++;
        continue;
      }

      const messageSent = await this.whatsapp.sendMessage(customer.phoneNumber, message);
      results.push({ customerId: customer.id, name: customer.name, balance: monthBalance, status: messageSent ? 'sent' : 'failed', statementUrl });
      if (messageSent) { sent++; } else { skipped++; }
    }

    this.logger.log(`Balance reminders vendor=${vendorId} sent=${sent} skipped=${skipped} dryRun=${dryRun} month=${targetMonth} includeStatement=${includeStatement}`);
    return { vendorId, sent, skipped, dryRun, month: targetMonth, includeStatement, paymentType: paymentType ?? 'BOTH', customers: results };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

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
   * Generate the monthly statement PDF for a customer, upload it to private storage,
   * and return a pre-signed URL valid for 7 days.
   * Returns null on any error so the reminder still sends without the link.
   */
  private async generateStatementUrl(vendorId: string, customerId: string, month: string): Promise<string | null> {
    try {
      const [year, mon] = month.split('-').map(Number);
      const startDate = new Date(year, mon - 1, 1);
      const endDate = this.monthEndDate(month);

      const customer = await this.prisma.customer.findFirst({ where: { id: customerId, vendorId } });
      if (!customer) return null;

      const transactions = await this.prisma.transaction.findMany({
        where: { customerId, vendorId, createdAt: { gte: startDate, lt: endDate } },
        include: { product: { select: { name: true } } },
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

      const pdfBuffer = await this.statementPdf.generate({ customer, transactions, openingBalance, closingBalance, period });
      const { key } = await this.storage.upload('statement-reminders', pdfBuffer, `statement-${customerId}-${month}.pdf`, 'application/pdf');
      return await this.storage.getSignedUrl(key, STATEMENT_URL_TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Statement generation failed for customer ${customerId} (${month}): ${err}`);
      return null;
    }
  }

  private currentMonth(): string {
    return new Date().toISOString().slice(0, 7);
  }

  private formatMonthLabel(month: string): string {
    const [year, mon] = month.split('-').map(Number);
    return new Date(year, mon - 1, 1).toLocaleString('en-PK', { month: 'long', year: 'numeric' });
  }
}
