import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { MessageTemplates } from '../whatsapp/templates/message.templates';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ScheduleReminderDto, SendNowDto, SendTargetedDto, PreviewDto } from './dto/schedule-reminder.dto';

const DEFAULT_CRON = '0 4 * * *'; // 9 AM PKT (UTC+5) — stored as UTC
const DEFAULT_MIN_BALANCE = 100;
const REPEATABLE_JOB_ID = (vendorId: string) => `balance-reminder:${vendorId}`;

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
  ) {}

  /** Remove existing BullMQ repeatable job for a vendor (does NOT touch DB) */
  private async removeQueueJob(vendorId: string): Promise<void> {
    const jobId = REPEATABLE_JOB_ID(vendorId);
    const repeatableJobs = await this.reminderQueue.getRepeatableJobs();
    const existing = repeatableJobs.filter((j) => j.id === jobId);
    for (const job of existing) {
      await this.reminderQueue.removeRepeatableByKey(job.key);
    }
  }

  /** Configure (or update) the repeatable daily reminder job for a vendor */
  async scheduleReminders(
    vendorId: string,
    dto: ScheduleReminderDto,
  ): Promise<ReminderScheduleStatus & { message: string }> {
    const cronExpression = dto.cronExpression ?? DEFAULT_CRON;
    const minBalance = dto.minBalance ?? DEFAULT_MIN_BALANCE;
    const jobId = REPEATABLE_JOB_ID(vendorId);

    // Remove any existing repeatable job for this vendor first
    await this.removeQueueJob(vendorId);

    await this.reminderQueue.add(
      JOB_NAMES.SEND_BALANCE_REMINDERS,
      { vendorId, minBalance },
      {
        repeat: { pattern: cronExpression, utc: true },
        jobId,
        removeOnComplete: 50,
        removeOnFail: 20,
      },
    );

    // Persist schedule config as source of truth
    await this.prisma.reminderScheduleConfig.upsert({
      where: { vendorId },
      update: { cronExpression, minBalance },
      create: { vendorId, cronExpression, minBalance },
    });

    // Fetch the newly created repeatable job to get nextRunAt
    const repeatableJobs = await this.reminderQueue.getRepeatableJobs();
    const job = repeatableJobs.find((j) => j.id === jobId);
    const nextRunAt = job?.next ? new Date(job.next).toISOString() : null;

    this.logger.log(
      `Scheduled balance reminders for vendor ${vendorId}: ${cronExpression}, minBalance=${minBalance}`,
    );

    return {
      vendorId,
      scheduled: true,
      cronExpression,
      minBalance,
      nextRunAt,
      message: 'Balance reminder schedule configured',
    };
  }

  /** Remove the repeatable reminder job for a vendor and clear DB config */
  async cancelReminders(vendorId: string): Promise<ReminderScheduleStatus & { message: string }> {
    await this.removeQueueJob(vendorId);

    await this.prisma.reminderScheduleConfig.deleteMany({
      where: { vendorId },
    });

    return {
      vendorId,
      scheduled: false,
      cronExpression: null,
      minBalance: null,
      nextRunAt: null,
      message: 'Balance reminder schedule removed',
    };
  }

  /** Get current schedule status for a vendor — DB is source of truth */
  async getScheduleStatus(vendorId: string): Promise<ReminderScheduleStatus> {
    const config = await this.prisma.reminderScheduleConfig.findUnique({
      where: { vendorId },
    });

    if (!config) {
      return {
        vendorId,
        scheduled: false,
        cronExpression: null,
        minBalance: null,
        nextRunAt: null,
      };
    }

    // Get nextRunAt from BullMQ (queue metadata only, not job data)
    const jobId = REPEATABLE_JOB_ID(vendorId);
    const repeatableJobs = await this.reminderQueue.getRepeatableJobs();
    const job = repeatableJobs.find((j) => j.id === jobId);
    const nextRunAt = job?.next ? new Date(job.next).toISOString() : null;

    return {
      vendorId,
      scheduled: true,
      cronExpression: config.cronExpression,
      minBalance: config.minBalance,
      nextRunAt,
    };
  }

  /** Immediately send reminders for all eligible customers of a vendor */
  async sendNow(vendorId: string, dto: SendNowDto) {
    const minBalance = dto.minBalance ?? DEFAULT_MIN_BALANCE;
    const dryRun = dto.dryRun ?? false;

    return this.processVendorReminders(vendorId, minBalance, dryRun);
  }

  /**
   * Send reminders to a targeted subset of customers.
   *   mode=single   — exactly one customer (customerIds[0])
   *   mode=selected — explicit list of customer IDs
   *   mode=eligible — all customers above minBalance threshold (same as sendNow)
   */
  async sendTargeted(vendorId: string, dto: SendTargetedDto) {
    const minBalance = dto.minBalance ?? DEFAULT_MIN_BALANCE;
    const dryRun = dto.dryRun ?? false;

    if (dto.mode === 'eligible') {
      return this.processVendorReminders(vendorId, minBalance, dryRun);
    }

    // single / selected — explicit customer list required
    const customerIds = dto.customerIds ?? [];
    if (customerIds.length === 0) {
      return { vendorId, sent: 0, skipped: 0, dryRun, customers: [], error: 'customerIds is required for mode=single or mode=selected' };
    }

    const customers = await this.prisma.customer.findMany({
      where: {
        id: { in: customerIds },
        vendorId,
        isActive: true,
        phoneNumber: { not: '' },
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        financialBalance: true,
      },
    });

    if (customers.length === 0) {
      return { vendorId, sent: 0, skipped: 0, dryRun, customers: [] };
    }

    let sent = 0;
    let skipped = 0;
    const results: Array<{
      customerId: string;
      name: string;
      balance: number;
      status: string;
    }> = [];

    for (const customer of customers) {
      const message = MessageTemplates.balanceReminder(
        customer.name,
        customer.financialBalance,
      );

      if (dryRun) {
        results.push({ customerId: customer.id, name: customer.name, balance: customer.financialBalance, status: 'would-send' });
        skipped++;
        continue;
      }

      const messageSent = await this.whatsapp.sendMessage(customer.phoneNumber, message);
      results.push({ customerId: customer.id, name: customer.name, balance: customer.financialBalance, status: messageSent ? 'sent' : 'failed' });
      if (messageSent) { sent++; } else { skipped++; }
    }

    this.logger.log(
      `Targeted reminders for vendor ${vendorId} (mode=${dto.mode}): sent=${sent}, skipped=${skipped}, dryRun=${dryRun}`,
    );

    return { vendorId, sent, skipped, dryRun, customers: results };
  }

  /**
   * Full eligibility preview — shows every candidate and why they would or would not receive a reminder.
   * Never sends messages. Always operates as dryRun=true.
   *
   * Eligibility reasons:
   *   would-send          — passes all checks
   *   skipped-low-balance — balance below minBalance
   *   skipped-no-phone    — phone number missing
   *   skipped-inactive    — customer is not active
   *   skipped-wrong-type  — paymentType is not MONTHLY
   */
  async previewReminders(vendorId: string, dto: PreviewDto) {
    const minBalance = dto.minBalance ?? DEFAULT_MIN_BALANCE;
    const mode = dto.mode ?? 'eligible';

    // Fetch candidates: for selected/single use explicit IDs; for eligible fetch all vendor customers
    const whereBase = mode === 'eligible'
      ? { vendorId }
      : { id: { in: dto.customerIds ?? [] }, vendorId };

    const candidates = await this.prisma.customer.findMany({
      where: whereBase,
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        financialBalance: true,
        isActive: true,
        paymentType: true,
      },
      orderBy: { financialBalance: 'desc' },
    });

    type PreviewEntry = {
      customerId: string;
      name: string;
      balance: number;
      phone: string;
      reason: string;
    };

    const wouldSend: PreviewEntry[] = [];
    const skipped: PreviewEntry[] = [];

    for (const c of candidates) {
      const entry: PreviewEntry = {
        customerId: c.id,
        name: c.name,
        balance: c.financialBalance,
        phone: c.phoneNumber,
        reason: '',
      };

      if (!c.isActive) {
        entry.reason = 'skipped-inactive';
        skipped.push(entry);
      } else if (c.paymentType !== 'MONTHLY') {
        entry.reason = 'skipped-wrong-type';
        skipped.push(entry);
      } else if (!c.phoneNumber || c.phoneNumber.trim() === '') {
        entry.reason = 'skipped-no-phone';
        skipped.push(entry);
      } else if (c.financialBalance < minBalance) {
        entry.reason = 'skipped-low-balance';
        skipped.push(entry);
      } else {
        entry.reason = 'would-send';
        wouldSend.push(entry);
      }
    }

    return {
      vendorId,
      mode,
      minBalance,
      totalWouldSend: wouldSend.length,
      totalSkipped: skipped.length,
      wouldSend,
      skipped,
    };
  }

  /** Core logic — called by BullMQ processor and sendNow */
  async processVendorReminders(
    vendorId: string,
    minBalance: number,
    dryRun = false,
  ) {
    const customers = await this.prisma.customer.findMany({
      where: {
        vendorId,
        paymentType: 'MONTHLY',
        isActive: true,
        financialBalance: { gte: minBalance },
        phoneNumber: { not: '' },
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
        financialBalance: true,
      },
      orderBy: { financialBalance: 'desc' },
    });

    if (customers.length === 0) {
      this.logger.log(
        `No customers with balance >= ${minBalance} for vendor ${vendorId}`,
      );
      return { vendorId, sent: 0, skipped: 0, dryRun, customers: [] };
    }

    let sent = 0;
    let skipped = 0;
    const results: Array<{
      customerId: string;
      name: string;
      balance: number;
      status: string;
    }> = [];

    for (const customer of customers) {
      const message = MessageTemplates.balanceReminder(
        customer.name,
        customer.financialBalance,
      );

      if (dryRun) {
        results.push({
          customerId: customer.id,
          name: customer.name,
          balance: customer.financialBalance,
          status: 'would-send',
        });
        skipped++;
        continue;
      }

      const messageSent = await this.whatsapp.sendMessage(
        customer.phoneNumber,
        message,
      );

      results.push({
        customerId: customer.id,
        name: customer.name,
        balance: customer.financialBalance,
        status: messageSent ? 'sent' : 'failed',
      });

      if (messageSent) {
        sent++;
      } else {
        skipped++;
      }
    }

    this.logger.log(
      `Balance reminders for vendor ${vendorId}: sent=${sent}, skipped=${skipped}, dryRun=${dryRun}`,
    );

    return { vendorId, sent, skipped, dryRun, customers: results };
  }
}
