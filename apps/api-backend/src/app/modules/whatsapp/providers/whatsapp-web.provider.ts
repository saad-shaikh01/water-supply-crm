import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { IWhatsAppProvider } from './whatsapp-provider.interface';

@Injectable()
export class WhatsAppWebProvider
  implements IWhatsAppProvider, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WhatsAppWebProvider.name);
  private client: any = null;
  private ready = false;
  private enabled = false;

  async onModuleInit() {
    if (process.env.WHATSAPP_ENABLED !== 'true') {
      this.logger.warn(
        'WhatsApp disabled (WHATSAPP_ENABLED != true). Set env to enable.',
      );
      return;
    }

    this.enabled = true;

    try {
      // Dynamic import to avoid crash if package not installed
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — optional peer dependency, installed separately
      const { Client, LocalAuth } = await import('whatsapp-web.js');
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — optional peer dependency, installed separately
      const qrcode = await import('qrcode-terminal');

      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: process.env.WHATSAPP_SESSION_PATH || './.whatsapp-sessions',
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
          ],
          executablePath:
            process.env.CHROMIUM_PATH ||
            process.env.PUPPETEER_EXECUTABLE_PATH ||
            undefined,
        },
      });

      this.client.on('qr', (qr: string) => {
        qrcode.generate(qr, { small: true });
        this.logger.log('📱 WhatsApp QR Code generated — Scan with your phone!');
      });

      this.client.on('authenticated', () => {
        this.logger.log('✅ WhatsApp authenticated successfully');
      });

      this.client.on('ready', () => {
        this.ready = true;
        this.logger.log('🟢 WhatsApp client is READY — Messages will be sent');
      });

      this.client.on('disconnected', (reason: string) => {
        this.ready = false;
        this.logger.warn(`🔴 WhatsApp disconnected: ${reason}`);
      });

      this.client.on('auth_failure', (msg: string) => {
        this.ready = false;
        this.logger.error(`WhatsApp auth failed: ${msg}`);
      });

      await this.client.initialize();
    } catch (error) {
      this.logger.error(
        'Failed to initialize WhatsApp client. Make sure whatsapp-web.js is installed.',
        error,
      );
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.destroy().catch(() => {});
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  async sendMessage(phone: string, message: string): Promise<boolean> {
    if (!this.enabled) {
      this.logger.debug(`[WhatsApp DISABLED] Would send to ${phone}: ${message}`);
      return false;
    }

    if (!this.ready || !this.client) {
      this.logger.warn(`WhatsApp not ready — message to ${phone} dropped`);
      return false;
    }

    try {
      // Format: remove +, spaces, dashes → append @c.us
      const cleaned = phone.replace(/[\s\-\+]/g, '');
      // Add country code if missing (Pakistan default: 92)
      const withCode = cleaned.startsWith('0')
        ? `92${cleaned.slice(1)}`
        : cleaned;
      const chatId = `${withCode}@c.us`;

      await this.client.sendMessage(chatId, message);
      this.logger.log(`✅ WhatsApp sent to ${phone}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send WhatsApp to ${phone}`, error);
      return false;
    }
  }
}
