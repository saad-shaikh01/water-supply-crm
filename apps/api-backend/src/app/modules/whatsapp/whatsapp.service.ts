import { Injectable, Inject, Logger } from '@nestjs/common';
import { CacheInvalidationService } from '@water-supply-crm/caching';
import {
  IWhatsAppProvider,
  WHATSAPP_PROVIDER,
} from './providers/whatsapp-provider.interface';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly RATE_LIMIT_TTL = 60000; // 1 message per phone per minute

  constructor(
    @Inject(WHATSAPP_PROVIDER)
    private readonly provider: IWhatsAppProvider,
    private readonly cache: CacheInvalidationService,
  ) {}

  isReady(): boolean {
    return this.provider.isReady();
  }

  async sendMessage(phone: string, message: string): Promise<boolean> {
    if (!phone || !message) return false;

    // Rate limiting: 1 message per phone per minute
    const rateLimitKey = `whatsapp:ratelimit:${phone.replace(/\D/g, '')}`;
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
    recipients: { phone: string; message: string }[],
    delayMs = 1500,
  ): Promise<{ sent: number; failed: number }> {
    let sent = 0;
    let failed = 0;

    for (const { phone, message } of recipients) {
      const success = await this.sendMessage(phone, message);
      success ? sent++ : failed++;

      // Delay between messages to avoid WhatsApp spam detection
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    return { sent, failed };
  }
}
