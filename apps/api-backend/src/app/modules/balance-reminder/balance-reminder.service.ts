import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { MessageTemplates } from '../whatsapp/templates/message.templates';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { ScheduleReminderDto, SendNowDto } from './dto/schedule-reminder.dto';

const DEFAULT_CRON = '0 4 * * *'; // 9 AM PKT (UTC+5)
const DEFAULT_MIN_BALANCE = 100;
const REPEATABLE_JOB_ID = (vendorId: string) => `balance-reminder:${vendorId}`;

@Injectable()
export class BalanceReminderService {
  private readonly logger = new Logger(BalanceReminderService.name);

  constructor(
    @InjectQueue(QUEUE_NAMES.BALANCE_REMINDERS)
    private readonly reminderQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly whatsapp: WhatsAppService,
  ) {}

  /** Configure (or update) the repeatable daily reminder job for a vendor */
  async scheduleReminders(vendorId: string, dto: ScheduleReminderDto) {
    const cronExpression = dto.cronExpression ?? DEFAULT_CRON;
    const minBalance = dto.minBalance ?? DEFAULT_MIN_BALANCE;
    const jobId = REPEATABLE_JOB_ID(vendorId);

    // Remove any existing repeatable job for this vendor
    await this.cancelReminders(vendorId);

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

    this.logger.log(
      `Scheduled balance reminders for vendor ${vendorId}: ${cronExpression}, minBalance=${minBalance}`,
    );

    return {
      vendorId,
      cronExpression,
      minBalance,
      message: 'Balance reminder schedule configured',
    };
  }

  /** Remove the repeatable reminder job for a vendor */
  async cancelReminders(vendorId: string) {
    const jobId = REPEATABLE_JOB_ID(vendorId);

    // Find and remove repeatable job by key prefix
    const repeatableJobs = await this.reminderQueue.getRepeatableJobs();
    const existing = repeatableJobs.filter((j) => j.id === jobId);

    for (const job of existing) {
      await this.reminderQueue.removeRepeatableByKey(job.key);
    }

    return { vendorId, message: 'Balance reminder schedule removed' };
  }

  /** Get current schedule status for a vendor */
  async getScheduleStatus(vendorId: string) {
    const jobId = REPEATABLE_JOB_ID(vendorId);
    const repeatableJobs = await this.reminderQueue.getRepeatableJobs();
    const existing = repeatableJobs.find((j) => j.id === jobId);

    if (!existing) {
      return { vendorId, scheduled: false };
    }

    return {
      vendorId,
      scheduled: true,
      cronExpression: existing.pattern,
      nextRunAt: existing.next ? new Date(existing.next).toISOString() : null,
    };
  }

  /** Immediately send reminders for all eligible customers of a vendor */
  async sendNow(vendorId: string, dto: SendNowDto) {
    const minBalance = dto.minBalance ?? DEFAULT_MIN_BALANCE;
    const dryRun = dto.dryRun ?? false;

    return this.processVendorReminders(vendorId, minBalance, dryRun);
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
      return { vendorId, sent: 0, skipped: 0, customers: [] };
    }

    let sent = 0;
    let skipped = 0;
    const results: Array<{ customerId: string; name: string; balance: number; status: string }> = [];

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
          status: 'dry-run',
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
        status: messageSent ? 'sent' : 'skipped',
      });

      if (messageSent) {
        sent++;
      } else {
        skipped++;
      }
    }

    this.logger.log(
      `Balance reminders for vendor ${vendorId}: sent=${sent}, skipped=${skipped}`,
    );

    return { vendorId, sent, skipped, customers: results };
  }
}
