import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import Redis from 'ioredis';
import { PrismaService } from '@water-supply-crm/database';
import { QUEUE_NAMES, JOB_NAMES, NOTIFICATION_EVENTS } from '@water-supply-crm/queue';
import { FcmService } from '../fcm/fcm.service';

const PENDING_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000; // 3 days
const REMINDER_TTL_SECONDS = 7 * 24 * 60 * 60; // re-remind after 7 days
const reminderKey = (paymentRequestId: string) => `payment-reminder-sent:${paymentRequestId}`;

@Processor(QUEUE_NAMES.PAYMENT_REMINDERS)
export class PaymentReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(PaymentReminderProcessor.name);
  private redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly fcm: FcmService,
  ) {
    super();
    const redisUrl = process.env['REDIS_URL'] || 'redis://localhost:6379';
    this.redis = new Redis(redisUrl);
  }

  async process(job: Job): Promise<void> {
    if (job.name !== JOB_NAMES.SEND_PAYMENT_REMINDERS) return;

    const cutoff = new Date(Date.now() - PENDING_THRESHOLD_MS);

    const staleRequests = await this.prisma.paymentRequest.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lte: cutoff },
      },
      select: {
        id: true,
        vendorId: true,
        amount: true,
        customer: { select: { name: true } },
      },
    });

    if (staleRequests.length === 0) {
      this.logger.log('No stale pending payment requests found');
      return;
    }

    let notified = 0;
    let skipped = 0;

    // Group by vendorId to send one FCM per vendor per run
    const byVendor = new Map<string, typeof staleRequests>();
    for (const req of staleRequests) {
      const alreadySent = await this.redis.get(reminderKey(req.id));
      if (alreadySent) { skipped++; continue; }
      const list = byVendor.get(req.vendorId) ?? [];
      list.push(req);
      byVendor.set(req.vendorId, list);
    }

    for (const [vendorId, requests] of byVendor.entries()) {
      const count = requests.length;
      const title = count === 1
        ? 'Payment Request Pending ⏳'
        : `${count} Payment Requests Pending ⏳`;
      const body = count === 1
        ? `${requests[0].customer.name}'s payment request has been pending for over 3 days.`
        : `${count} payment requests have been pending for over 3 days. Please review.`;

      await this.fcm
        .sendToVendorUsers(vendorId, title, body, {
          type: NOTIFICATION_EVENTS.PAYMENT_REQUEST_PENDING,
        })
        .catch((e: Error) =>
          this.logger.warn(`FCM payment reminder failed for vendor ${vendorId}: ${e.message}`),
        );

      // Mark each request as reminded
      for (const req of requests) {
        await this.redis.setex(reminderKey(req.id), REMINDER_TTL_SECONDS, '1');
        notified++;
      }
    }

    this.logger.log(`Payment reminders: ${notified} notified, ${skipped} skipped (recently reminded)`);
  }
}
