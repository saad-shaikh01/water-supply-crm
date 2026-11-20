import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_NAMES, JOB_NAMES } from '@water-supply-crm/queue';
import { PrismaService } from '@water-supply-crm/database';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { DeliveryReceiptPdfService } from '../whatsapp/delivery-receipt-pdf.service';
import { CloudTemplateNames } from '../whatsapp/templates/cloud-template-names';
import { FcmService } from '../fcm/fcm.service';
import { StorageService } from '../../common/storage/storage.service';
import { VendorBrandingService } from '../vendor-branding/vendor-branding.service';
import { NotificationSettingsService } from './notification-settings.service';
import { NotificationChannel, NotificationType } from '@prisma/client';
import type { SendFailure } from '../whatsapp/providers/whatsapp-provider.interface';

/** What a send learned along the way, beyond pass/fail — recorded on the log row. */
interface SendContext {
  messageId?: string;
  failure?: SendFailure;
}

/**
 * A send that provably never reached WhatsApp (e.g. the PDF upload dropped) — thrown so BullMQ re-runs the
 * job with backoff. Only the final attempt writes a FAILED log row, so one receipt is never logged 4 times.
 */
export class TransientSendError extends Error {
  constructor(
    message: string,
    readonly failure?: SendFailure,
  ) {
    super(message);
    this.name = 'TransientSendError';
  }
}

// Same wording the enqueue-time gate (NotificationLogService.logSkipped) records — the CRM's "Disabled"
// filter matches on it.
const DISABLED_BY_VENDOR_REASON = 'Disabled by vendor notification settings';

const WHATSAPP_JOB_NAMES: string[] = [
  JOB_NAMES.SEND_WHATSAPP,
  JOB_NAMES.SEND_WHATSAPP_TEMPLATE,
  JOB_NAMES.SEND_WHATSAPP_PDF,
  JOB_NAMES.SEND_WHATSAPP_DELIVERY_FAILURE,
];

// Reason recorded in NotificationLog when the P0 vendor gate (WHATSAPP_GUARD_MODE=enforce) stops a send.
const VENDOR_BLOCKED_REASON =
  'WhatsApp not enabled for this vendor yet (vendor-level WhatsApp setup pending) — message not sent';

// Short-lived on purpose — this URL is only ever handed to Meta once, immediately
// after generation, for it to fetch the header image. No need for a long window.
const DELIVERY_FAILURE_PHOTO_URL_TTL_SECONDS = 300;

@Processor(QUEUE_NAMES.NOTIFICATIONS)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly whatsapp: WhatsAppService,
    private readonly pdfService: DeliveryReceiptPdfService,
    private readonly fcm: FcmService,
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly branding: VendorBrandingService,
    private readonly settings: NotificationSettingsService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const queuedAt = new Date(job.timestamp);

    // The vendor may have switched this message type off after it was queued (or while a retry was waiting) —
    // never send, and never retry, something the vendor turned off.
    if (await this.isDisabledByVendor(job)) {
      this.logger.log(`Skipping ${job.name} to ${job.data.phoneNumber}: ${DISABLED_BY_VENDOR_REASON}`);
      await this.writeLog(job, 'SKIPPED', queuedAt, DISABLED_BY_VENDOR_REASON);
      return;
    }

    const ctx: SendContext = {};
    try {
      const failReason = await this.handleJob(job, ctx);
      if (failReason) {
        await this.writeLog(job, 'FAILED', queuedAt, failReason, ctx);
      } else {
        await this.writeLog(job, 'SENT', queuedAt, null, ctx);
      }
    } catch (err: any) {
      if (err instanceof TransientSendError && !this.isFinalAttempt(job)) {
        this.logger.warn(
          `${job.name} to ${job.data.phoneNumber} hit a transient failure (attempt ${(job.attemptsMade ?? 0) + 1}/${job.opts?.attempts}): ${err.message} — will retry`,
        );
        throw err; // BullMQ re-runs it after the backoff; no log row until it finally succeeds or gives up
      }
      await this.writeLog(
        job,
        'FAILED',
        queuedAt,
        err?.message ?? 'Unknown error',
        err instanceof TransientSendError ? { failure: err.failure } : ctx,
      );
      throw err;
    }
  }

  private isFinalAttempt(job: Job): boolean {
    return (job.attemptsMade ?? 0) + 1 >= (job.opts?.attempts ?? 1);
  }

  /** Fail-open: if the settings lookup itself errors, the send goes ahead exactly as it did before this check existed. */
  private async isDisabledByVendor(job: Job): Promise<boolean> {
    const { vendorId, type } = job.data ?? {};
    if (!WHATSAPP_JOB_NAMES.includes(job.name) || !vendorId || !type) return false;
    try {
      return !(await this.settings.isEnabled(vendorId, type as NotificationType, NotificationChannel.WHATSAPP));
    } catch (e: any) {
      this.logger.warn(`Notification-settings check failed for vendor ${vendorId}, sending anyway: ${e?.message}`);
      return false;
    }
  }

  private async handleJob(job: Job, ctx: SendContext): Promise<string | null> {
    switch (job.name) {
      case JOB_NAMES.SEND_WHATSAPP: {
        const { phoneNumber, message, entityType, entityId, vendorId } = job.data;
        if (!(await this.whatsapp.canSendFor(vendorId))) return VENDOR_BLOCKED_REASON;
        const sent = await this.whatsapp.sendMessage(vendorId, phoneNumber, message);
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
      case JOB_NAMES.SEND_WHATSAPP_TEMPLATE: {
        const { phoneNumber, templateName, bodyParams, vendorId } = job.data as {
          phoneNumber: string;
          templateName: string;
          bodyParams: string[];
          vendorId?: string;
        };
        if (!(await this.whatsapp.canSendFor(vendorId))) return VENDOR_BLOCKED_REASON;
        const result = await this.whatsapp.sendTemplateDetailed(vendorId, phoneNumber, templateName, bodyParams);
        if (result.ok === true) {
          ctx.messageId = result.messageId;
          this.logger.log(`WhatsApp template "${templateName}" sent to ${phoneNumber}`);
          return null;
        }
        ctx.failure = result;
        const why = this.describeFailure(result);
        if (result.retryable) throw new TransientSendError(`Template "${templateName}" not delivered — ${why}`, result);
        return `Template "${templateName}" not delivered — ${why}`;
      }
      case JOB_NAMES.SEND_WHATSAPP_PDF: {
        const { phoneNumber, receiptData, entityType, entityId, vendorId } = job.data;
        if (!(await this.whatsapp.canSendFor(vendorId))) return VENDOR_BLOCKED_REASON;
        const branding = await this.branding.resolveForDocs(vendorId, receiptData['vendorName'] as string | undefined);
        const pdfBuffer = await this.pdfService.generate(receiptData as any, branding);
        const filename = `${this.sanitizeForFilename(receiptData['customerCode'] as string)}-${this.sanitizeForFilename(receiptData['customerName'] as string)}-${receiptData['deliveryDate']}.pdf`;
        // delivery_receipt (Meta-approved) takes 3 body vars: {{1}} name, {{2}} customer code, {{3}} delivery date —
        // sending fewer/more than what's approved fails with Graph API error 132000.
        const formattedDeliveryDate = new Date(receiptData['deliveryDate'] as string).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'long',
          year: 'numeric',
        });
        // Corrections use `delivery_corrected` (also a DOCUMENT-header template) instead.
        const override = job.data['template'] as { name: string; bodyParams: string[] } | undefined;
        const result = await this.whatsapp.sendTemplateDetailed(
          vendorId,
          phoneNumber,
          override?.name ?? CloudTemplateNames.DELIVERY_RECEIPT,
          override?.bodyParams ?? [receiptData['customerName'] as string, receiptData['customerCode'] as string, formattedDeliveryDate],
          { buffer: pdfBuffer, filename },
        );
        if (result.ok === true) {
          ctx.messageId = result.messageId;
          this.logger.log(`WhatsApp PDF sent to ${phoneNumber}`);
          if (entityType === 'DELIVERY_ITEM' && entityId) {
            await this.prisma.dailySheetItem
              .update({ where: { id: entityId }, data: { whatsappSentAt: new Date() } })
              .catch((e: Error) => this.logger.warn(`Failed to update whatsappSentAt for item ${entityId}: ${e.message}`));
          }
          return null;
        }
        ctx.failure = result;
        const why = this.describeFailure(result);
        if (result.retryable) throw new TransientSendError(`PDF not delivered — ${why}`, result);
        return `PDF not delivered — ${why}`;
      }
      case JOB_NAMES.SEND_WHATSAPP_DELIVERY_FAILURE: {
        const { phoneNumber, data, entityType, entityId, vendorId } = job.data as {
          vendorId?: string;
          phoneNumber: string;
          data: { customerName: string; customerCode: string; reasonText: string; photoKey?: string | null };
          entityType?: string;
          entityId?: string;
        };

        if (!(await this.whatsapp.canSendFor(vendorId))) return VENDOR_BLOCKED_REASON;

        let imageUrl: string | undefined;
        if (data.photoKey) {
          imageUrl = await this.storage
            .getSignedUrl(data.photoKey, DELIVERY_FAILURE_PHOTO_URL_TTL_SECONDS)
            .catch((e: Error) => {
              this.logger.warn(`Failed to sign delivery-failure photo URL, falling back to text-only: ${e.message}`);
              return undefined;
            });
        }

        const templateName = imageUrl
          ? CloudTemplateNames.DELIVERY_UNSUCCESSFUL_PHOTO
          : CloudTemplateNames.DELIVERY_UNSUCCESSFUL;

        const sent = await this.whatsapp.sendTemplate(
          vendorId,
          phoneNumber,
          templateName,
          [data.customerName, data.customerCode, data.reasonText],
          undefined,
          imageUrl,
        );
        if (sent) {
          this.logger.log(`WhatsApp delivery-failure notice sent to ${phoneNumber} (template=${templateName})`);
          return null;
        }
        return `Delivery-failure notice not delivered (template=${templateName}) — WhatsApp not ready, number not registered, or template not yet approved`;
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

  private describeFailure(f: { reason: string; code?: string | number }): string {
    return f.code !== undefined && f.code !== null ? `${f.reason} [${f.code}]` : f.reason;
  }

  private sanitizeForFilename(value: string | undefined | null): string {
    return (value ?? '').trim().replace(/[^a-zA-Z0-9-]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
  }

  private async writeLog(
    job: Job,
    status: 'SENT' | 'FAILED' | 'SKIPPED',
    queuedAt: Date,
    error: string | null,
    ctx: SendContext = {},
  ): Promise<void> {
    const channel =
      WHATSAPP_JOB_NAMES.includes(job.name) ? 'WHATSAPP'
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
          eventType: job.data.eventType ?? job.data.type ?? null,
          entityType: job.data.entityType ?? null,
          entityId: job.data.entityId ?? null,
          recipientType: job.data.recipientType ?? null,
          recipientId: job.data.recipientId ?? null,
          vendorId: job.data.vendorId ?? null,
          attemptCount: (job.attemptsMade ?? 0) + 1,
          lastError: error,
          errorCode: ctx.failure?.code !== undefined && ctx.failure?.code !== null ? String(ctx.failure.code) : null,
          errorStage: ctx.failure?.stage ?? null,
          retryable: ctx.failure ? ctx.failure.retryable : null,
          waMessageId: status === 'SENT' ? (ctx.messageId ?? null) : null,
          // Set when this row is the outcome of a retry from the log page, so the original row can show it.
          retryOfId: job.data.retryOfLogId ?? null,
          queuedAt,
          sentAt: status === 'SENT' ? now : null,
          failedAt: status === 'FAILED' ? now : null,
          // Kept only for failed WhatsApp sends so they can be retried from the log page.
          ...(status === 'FAILED' && channel === 'WHATSAPP'
            ? { jobName: job.name, payload: job.data ?? undefined }
            : {}),
        },
      })
      .catch((e) =>
        this.logger.warn(`Failed to write notification log: ${e.message}`),
      );
  }
}
