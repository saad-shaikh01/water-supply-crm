import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { IWhatsAppProvider } from './whatsapp-provider.interface';
import { normalizePhone } from '../phone.util';

@Injectable()
export class WhatsAppWebProvider
  implements IWhatsAppProvider, OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(WhatsAppWebProvider.name);
  private client: any = null;
  private ready = false;
  private enabled = false;
  private qrDataUrl: string | null = null;
  private initAttempts = 0;

  /** Puppeteer startup races ("Requesting main frame too early!") are transient — retry a few times */
  private static readonly MAX_INIT_RETRIES = 3;
  private static readonly INIT_RETRY_DELAY_MS = 10_000;

  async onModuleInit() {
    if (process.env.WHATSAPP_ENABLED !== 'true') {
      this.logger.warn(
        'WhatsApp disabled (WHATSAPP_ENABLED != true). Set env to enable.',
      );
      return;
    }
    this.enabled = true;
    // Fire-and-forget: Chromium startup (+ retries) can take a minute —
    // don't hold the whole NestJS bootstrap hostage to it.
    void this.initClient();
  }

  private async initClient() {
    try {
      // webpackIgnore prevents webpack from trying to bundle these optional packages
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — optional peer dependency, installed separately
      const { Client, LocalAuth } = await import(/* webpackIgnore: true */ 'whatsapp-web.js');
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — optional peer dependency, installed separately
      const QRCode = await import(/* webpackIgnore: true */ 'qrcode');
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — optional peer dependency, installed separately
      const qrcodeTerminal = await import(/* webpackIgnore: true */ 'qrcode-terminal');

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
            '--disable-gpu',
            // NOTE: '--single-process' and '--no-zygote' removed — they cause
            // page crashes / stuck "authenticated but never ready" states.
          ],
          executablePath:
            process.env.CHROMIUM_PATH ||
            process.env.PUPPETEER_EXECUTABLE_PATH ||
            undefined,
        },
      });

      this.client.on('qr', async (qr: string) => {
        this.logger.log('📱 WhatsApp QR Code generated — Scan with your phone!');
        try {
          (qrcodeTerminal.default ?? qrcodeTerminal).generate(qr, { small: true });
        } catch {
          // terminal QR is best-effort; dashboard QR below is the fallback
        }
        try {
          this.qrDataUrl = await QRCode.default.toDataURL(qr);
        } catch {
          this.qrDataUrl = null;
        }
      });

      this.client.on('authenticated', () => {
        this.logger.log('✅ WhatsApp authenticated successfully');
        this.qrDataUrl = null;
      });

      this.client.on('ready', () => {
        this.ready = true;
        this.qrDataUrl = null;
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
      this.initAttempts = 0;
    } catch (error: any) {
      this.logger.error(
        `Failed to initialize WhatsApp client: ${error?.message ?? error}`,
      );
      if (error?.stack) this.logger.error(error.stack);

      // Tear down the half-initialized client so the retry starts clean
      await this.client?.destroy?.().catch(() => {});
      this.client = null;

      if (this.initAttempts < WhatsAppWebProvider.MAX_INIT_RETRIES) {
        this.initAttempts++;
        this.logger.warn(
          `Retrying WhatsApp init in ${WhatsAppWebProvider.INIT_RETRY_DELAY_MS / 1000}s (attempt ${this.initAttempts}/${WhatsAppWebProvider.MAX_INIT_RETRIES})…`,
        );
        await new Promise((r) => setTimeout(r, WhatsAppWebProvider.INIT_RETRY_DELAY_MS));
        return this.initClient();
      }
      this.logger.error('WhatsApp init failed after all retries — restart the app to try again');
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

  getQr(): string | null {
    return this.qrDataUrl;
  }

  async logout(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.logout().catch(() => {});
      await this.client.destroy().catch(() => {});
    } finally {
      this.client = null;
      this.ready = false;
      this.qrDataUrl = null;
    }
    // Re-initialize so a new QR is generated
    await this.initClient();
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
      const chatId = this.toChatId(phone);
      await this.client.sendMessage(chatId, message);
      this.logger.log(`✅ WhatsApp sent to ${phone}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send WhatsApp to ${phone}`, error);
      return false;
    }
  }

  async sendDocument(phone: string, pdfBuffer: Buffer, filename: string, caption?: string): Promise<boolean> {
    if (!this.enabled) {
      this.logger.debug(`[WhatsApp DISABLED] Would send PDF to ${phone}: ${filename}`);
      return false;
    }

    if (!this.ready || !this.client) {
      this.logger.warn(`WhatsApp not ready — PDF to ${phone} dropped`);
      return false;
    }

    try {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore — optional peer dependency
      const { MessageMedia } = await import(/* webpackIgnore: true */ 'whatsapp-web.js');
      const base64 = pdfBuffer.toString('base64');
      const media = new MessageMedia('application/pdf', base64, filename);
      const chatId = this.toChatId(phone);
      await this.client.sendMessage(chatId, media, {
        sendMediaAsDocument: true,
        caption: caption ?? '',
      });
      this.logger.log(`✅ WhatsApp PDF sent to ${phone}: ${filename}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send WhatsApp PDF to ${phone}`, error);
      return false;
    }
  }

  private toChatId(phone: string): string {
    // Digits only, always with country code — see phone.util.ts
    return `${normalizePhone(phone)}@c.us`;
  }
}
