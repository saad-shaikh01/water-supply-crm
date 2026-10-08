import { Injectable, Inject, Logger } from '@nestjs/common';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import {
  IWhatsAppProvider,
  WHATSAPP_PROVIDER,
} from './providers/whatsapp-provider.interface';
import { evaluateGate, isBlocked } from '../../common/tenant-gate/legacy-vendor-gate';

/**
 * Every send takes the owning `vendorId` first. P0 stop-gap (see legacy-vendor-gate.ts): the
 * platform WhatsApp number may only be used for vendors in WHATSAPP_ALLOWED_VENDOR_IDS once
 * WHATSAPP_GUARD_MODE=enforce; in the default `shadow` mode nothing is blocked, only logged.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly RATE_LIMIT_TTL = 60000; // 1 message per vendor+phone per minute

  constructor(
    @Inject(WHATSAPP_PROVIDER)
    private readonly provider: IWhatsAppProvider,
    private readonly cache: CacheInvalidationService,
  ) {}

  isReady(): boolean {
    return this.provider.isReady();
  }

  /** Side-effect-free: would the gate stop this vendor right now? (lets callers log a precise reason) */
  isBlockedForVendor(vendorId?: string | null): boolean {
    return isBlocked(vendorId);
  }

  private rateLimitKey(vendorId: string | null | undefined, phone: string): string {
    return `whatsapp:ratelimit:${vendorId ?? 'none'}:${phone.replace(/\D/g, '')}`;
  }

  async sendDocument(
    vendorId: string | null | undefined,
    phone: string,
    pdfBuffer: Buffer,
    filename: string,
    caption?: string,
  ): Promise<boolean> {
    if (!phone || !pdfBuffer) return false;
    if (evaluateGate(vendorId, 'whatsapp.sendDocument').blocked) return false;
    return this.provider.sendDocument(phone, pdfBuffer, filename, caption);
  }

  async sendTemplate(
    vendorId: string | null | undefined,
    phone: string,
    templateName: string,
    bodyParams: string[],
    document?: { buffer: Buffer; filename: string },
    imageUrl?: string,
  ): Promise<boolean> {
    if (!phone || !templateName) return false;
    if (evaluateGate(vendorId, `whatsapp.sendTemplate(${templateName})`).blocked) return false;

    // Rate limiting: 1 message per vendor+phone per minute
    const rateLimitKey = this.rateLimitKey(vendorId, phone);
    const isLimited = await this.cache.get<boolean>(rateLimitKey);

    if (isLimited) {
      this.logger.debug(`Rate limited WhatsApp template to ${phone}`);
      return false;
    }

    const sent = await this.provider.sendTemplate(phone, templateName, bodyParams, document, imageUrl);

    if (sent) {
      await this.cache.set(rateLimitKey, true, this.RATE_LIMIT_TTL);
    }

    return sent;
  }

  async sendMessage(vendorId: string | null | undefined, phone: string, message: string): Promise<boolean> {
    if (!phone || !message) return false;
    if (evaluateGate(vendorId, 'whatsapp.sendMessage').blocked) return false;

    // Rate limiting: 1 message per vendor+phone per minute
    const rateLimitKey = this.rateLimitKey(vendorId, phone);
    const isLimited = await this.cache.get<boolean>(rateLimitKey);

    if (isLimited) {
      this.logger.debug(`Rate limited WhatsApp to ${phone}`);
      return false;
    }

    const sent = await this.provider.sendMessage(phone, message);

    if (sent) {
      // Set rate limit flag for 1 minute
      await this.cache.set(rateLimitKey, true, this.RATE_LIMIT_TTL);
    }

    return sent;
  }

  async sendBulk(
    vendorId: string | null | undefined,
    recipients: { phone: string; message: string }[],
    delayMs = 1500,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (const { phone, message } of recipients) {
      const success = await this.sendMessage(vendorId, phone, message);
      success ? sent++ : failed++;

      // Delay between messages to avoid WhatsApp spam detection
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    return { sent, failed };
  }
}
