import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { PrismaService } from '@water-supply-crm/database';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { DeliveryReceiptPdfService } from '../whatsapp/delivery-receipt-pdf.service';
import { FcmService } from '../fcm/fcm.service';

@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly pdfService: DeliveryReceiptPdfService,
    private readonly fcm: FcmService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const queuedAt = new Date(job.timestamp);

    try {
      const failReason = await this.handleJob(job);
      if (failReason) {
        await this.writeLog(job, 'FAILED', queuedAt, failReason);
      } else {
        await this.writeLog(job, 'SENT', queuedAt, null);
      }
    } catch (err: any) {
      await this.writeLog(job, 'FAILED', queuedAt, err?.message ?? 'Unknown error');
      throw err;
    }
  }

  private async handleJob(job: Job): Promise<string | null> {
    switch (job.name) {
      case JOB_NAMES.SEND_WHATSAPP: {
        const { phoneNumber, message, entityType, entityId } = job.data;
        const sent = await this.whatsapp.sendMessage(phoneNumber, message);
        if (sent) {
          this.logger.log(`WhatsApp sent to ${phoneNumber}`);
          if (entityType === 'DELIVERY_ITEM' && entityId) {
            await this.prisma.dailySheetItem
              .update({ where: { id: entityId }, data: { whatsappSentAt: new Date() } })
              .catch((e: Error) => this.logger.warn(`Failed to update whatsappSentAt for item ${entityId}: ${e.message}`));
          }
          return null;
        } else {
          this.logger.warn(`WhatsApp not sent to ${phoneNumber} (number not on WhatsApp / disabled / not ready)`);
          return 'Message not delivered — number may not be on WhatsApp or client not ready';
        }
      }
      case JOB_NAMES.SEND_WHATSAPP_PDF: {
        const { phoneNumber, receiptData, entityType, entityId } = job.data;
        const pdfBuffer = await this.pdfService.generate(receiptData as any);
        const filename = `${this.sanitizeForFilename(receiptData['customerCode'] as string)}-${this.sanitizeForFilename(receiptData['customerName'] as string)}-${receiptData['deliveryDate']}.pdf`;
        const caption = `Assalam o Alaikum ${receiptData['customerName']}! ✅\n\nAapki delivery receipt attached hai. Shukriya!`;
        const sent = await this.whatsapp.sendDocument(phoneNumber, pdfBuffer, filename, caption);
        if (sent) {
          this.logger.log(`WhatsApp PDF sent to ${phoneNumber}`);
          if (entityType === 'DELIVERY_ITEM' && entityId) {
            await this.prisma.dailySheetItem
              .update({ where: { id: entityId }, data: { whatsappSentAt: new Date() } })
              .catch((e: Error) => this.logger.warn(`Failed to update whatsappSentAt for item ${entityId}: ${e.message}`));
          }
          return null;
        } else {
          return 'PDF not delivered — WhatsApp not ready or number not registered';
        }
      }
      case JOB_NAMES.SEND_SMS:
        this.logger.log(`[Stub] Sending SMS to ${job.data.phoneNumber}: ${job.data.message}`);
        return null;
      case JOB_NAMES.SEND_FCM_NOTIFICATION: {
        const { userId, title, body, data } = job.data;
        const result = await this.fcm.sendToUser(userId, title, body, data);
        this.logger.log(`FCM sent to user ${userId}: ${result.sent} sent, ${result.failed} failed`);
        return null;
      }
      default:
        this.logger.warn(`Unknown notification job: ${job.name}`);
        return null;
    }
  }

  private sanitizeForFilename(value: string | undefined | null): string {
    return (value ?? '').trim().replace(/[^a-zA-Z0-9-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
  }

  private async writeLog(
    job: Job,
    status: 'SENT' | 'FAILED',
    queuedAt: Date,
    error: string | null,
  ): Promise<void> {
    const channel =
      job.name === JOB_NAMES.SEND_WHATSAPP || job.name === JOB_NAMES.SEND_WHATSAPP_PDF ? 'WHATSAPP'
      : job.name === JOB_NAMES.SEND_SMS ? 'SMS'
      : 'FCM';

    const recipientAddress = job.data.phoneNumber ?? job.data.userId ?? null;
    const now = new Date();

    await this.prisma.notificationLog
      .create({
        data: {
          channel,
          status,
          recipientAddress,
          eventType: job.data.eventType ?? null,
          entityType: job.data.entityType ?? null,
          entityId: job.data.entityId ?? null,
          recipientType: job.data.recipientType ?? null,
          recipientId: job.data.recipientId ?? null,
          vendorId: job.data.vendorId ?? null,
          attemptCount: (job.attemptsMade ?? 0) + 1,
          lastError: error,
          queuedAt,
          sentAt: status === 'SENT' ? now : null,
          failedAt: status === 'FAILED' ? now : null,
        },
      })
      .catch((e) =>
        this.logger.warn(`Failed to write notification log: ${e.message}`),
      );
  }
}
