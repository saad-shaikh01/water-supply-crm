import { Injectable, Inject, Logger } from '@nestjs/common';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import {
  IWhatsAppProvider,
  WHATSAPP_PROVIDER,
} from './providers/whatsapp-provider.interface';
import { WhatsAppAccountService } from './whatsapp-account.service';
import { templateNameFor } from './templates/template-catalog';
import { isLegacyVendor } from '../../common/tenant-gate/legacy-vendor-gate';

/**
 * Every send takes the owning `vendorId` first and is routed per vendor (WhatsAppAccountService.routeFor):
 * the vendor's own READY WhatsApp account when it has one; otherwise the platform number ONLY while the
 * P0 gate lets that vendor through (default `shadow`, `off`, or the legacy allow-list) — see
 * legacy-vendor-gate.ts. A vendor with neither is blocked: its messages are never sent from someone
 * else's number.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly RATE_LIMIT_TTL = 60000; // 1 message per vendor+phone per minute

  constructor(
    @Inject(WHATSAPP_PROVIDER)
    private readonly provider: IWhatsAppProvider,
    private readonly cache: CacheInvalidationService,
    private readonly accounts: WhatsAppAccountService,
  ) {}

  /** Platform (env-level) credentials ready? Vendor-specific readiness: see canSendFor / WhatsAppAccountService. */
  isReady(): boolean {
    return this.provider.isReady();
  }

  /**
   * Can THIS vendor's messages be sent right now — through its own account, or the platform number where the
   * gate allows it — and is that sender actually configured? Used by bulk loops to abort a batch cleanly
   * (replaces the platform-only isReady(), which is wrong for a vendor that has its own account).
   */
  async isReadyFor(vendorId?: string | null): Promise<boolean> {
    const route = await this.accounts.routeFor(vendorId, 'readiness-check', true);
    return !!route && this.provider.isReady(route.creds);
  }

  /** Side-effect-free: could a message for this vendor leave right now (its own account, or an allowed platform fallback)? */
  canSendFor(vendorId?: string | null): Promise<boolean> {
    return this.accounts.canSend(vendorId);
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
    const route = await this.accounts.routeFor(vendorId, 'whatsapp.sendDocument');
    if (!route) return false;
    return this.provider.sendDocument(phone, pdfBuffer, filename, caption, route.creds);
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
    const route = await this.accounts.routeFor(vendorId, `whatsapp.sendTemplate(${templateName})`);
    if (!route) return false;

    // On a vendor's own account the template name carries its brand suffix (several brands may share one
    // WABA), and a template Meta is KNOWN not to have approved is skipped with a clear log line instead of
    // failing at Meta. Blue Ice (legacy allow-list) is exempt until its template sync has proven accurate.
    if (route.source === 'ACCOUNT' && route.accountId) {
      templateName = templateNameFor(templateName, route.templateSuffix);
      if (!isLegacyVendor(vendorId) && !(await this.accounts.templateSendable(route.accountId, templateName))) return false;
    }

    // Rate limiting: 1 message per vendor+phone per minute
    const rateLimitKey = this.rateLimitKey(vendorId, phone);
    const isLimited = await this.cache.get<boolean>(rateLimitKey);

    if (isLimited) {
      this.logger.debug(`Rate limited WhatsApp template to ${phone}`);
      return false;
    }

    const sent = await this.provider.sendTemplate(phone, templateName, bodyParams, document, imageUrl, route.creds);

    if (sent) {
      await this.cache.set(rateLimitKey, true, this.RATE_LIMIT_TTL);
    }

    return sent;
  }

  async sendMessage(vendorId: string | null | undefined, phone: string, message: string): Promise<boolean> {
    if (!phone || !message) return false;
    const route = await this.accounts.routeFor(vendorId, 'whatsapp.sendMessage');
    if (!route) return false;

    // Rate limiting: 1 message per vendor+phone per minute
    const rateLimitKey = this.rateLimitKey(vendorId, phone);
    const isLimited = await this.cache.get<boolean>(rateLimitKey);

    if (isLimited) {
      this.logger.debug(`Rate limited WhatsApp to ${phone}`);
      return false;
    }

    const sent = await this.provider.sendMessage(phone, message, route.creds);

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
