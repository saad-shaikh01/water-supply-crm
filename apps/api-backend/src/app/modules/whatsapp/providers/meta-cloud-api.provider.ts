import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IWhatsAppProvider } from './whatsapp-provider.interface';
import { normalizePhone } from '../phone.util';

const TIMEOUT_MS = 12_000;
const MAX_RETRIES = 2; // only for HTTP 429/5xx — Meta guarantees these mean "not processed"
const RETRY_BACKOFF_MS = [500, 1500];

@Injectable()
export class MetaCloudApiProvider implements IWhatsAppProvider, OnModuleInit {
  private readonly logger = new Logger(MetaCloudApiProvider.name);
  private readonly enabled = process.env['WHATSAPP_ENABLED'] === 'true';
  private readonly accessToken = process.env['META_WA_ACCESS_TOKEN'] || '';
  private readonly phoneNumberId = process.env['META_WA_PHONE_NUMBER_ID'] || '';
  private readonly apiVersion = process.env['META_WA_API_VERSION'] || 'v21.0';
  private readonly baseUrl = `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}`;

  onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('WhatsApp disabled (WHATSAPP_ENABLED != true). Set env to enable.');
      return;
    }
    if (!this.accessToken || !this.phoneNumberId) {
      this.logger.warn(
        'WhatsApp enabled but misconfigured — META_WA_ACCESS_TOKEN / META_WA_PHONE_NUMBER_ID missing. Messages will not send.',
      );
      return;
    }
    this.logger.log(
      `🟢 WhatsApp Cloud API configured (phoneNumberId=${this.phoneNumberId}, apiVersion=${this.apiVersion})`,
    );
  }

  isReady(): boolean {
    return this.enabled && !!this.accessToken && !!this.phoneNumberId;
  }

  async sendMessage(phone: string, message: string): Promise<boolean> {
    if (!this.isReady()) return false;
    const to = normalizePhone(phone);
    const result = await this.postGraph(
      '/messages',
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: message } },
      `text message to ${to}`,
    );
    if (result) this.logger.log(`✅ WhatsApp text sent to ${to}`);
    return !!result;
  }

  async sendDocument(
    phone: string,
    pdfBuffer: Buffer,
    filename: string,
    caption?: string,
  ): Promise<boolean> {
    if (!this.isReady()) return false;
    const to = normalizePhone(phone);

    const mediaId = await this.uploadMedia(pdfBuffer, filename, 'application/pdf', `document upload for ${to}`);
    if (!mediaId) return false;

    const result = await this.postGraph(
      '/messages',
      {
        messaging_product: 'whatsapp',
        to,
        type: 'document',
        document: { id: mediaId, filename, caption: caption ?? '' },
      },
      `document message to ${to}`,
    );
    if (result) this.logger.log(`✅ WhatsApp document sent to ${to}: ${filename}`);
    return !!result;
  }

  async sendTemplate(
    phone: string,
    templateName: string,
    bodyParams: string[],
    document?: { buffer: Buffer; filename: string },
  ): Promise<boolean> {
    if (!this.isReady()) return false;
    const to = normalizePhone(phone);

    let mediaId: string | null = null;
    if (document) {
      mediaId = await this.uploadMedia(document.buffer, document.filename, 'application/pdf', `template media for ${to}`);
      if (!mediaId) return false;
    }

    const components: Array<Record<string, unknown>> = [];
    if (mediaId && document) {
      components.push({
        type: 'header',
        parameters: [{ type: 'document', document: { id: mediaId, filename: document.filename } }],
      });
    }

    // Meta rejects empty-string template variables outright — coerce falsy values.
    const safeParams = bodyParams.map((p) => (p && String(p).trim() ? String(p) : '-'));
    components.push({
      type: 'body',
      parameters: safeParams.map((text) => ({ type: 'text', text })),
    });

    const result = await this.postGraph(
      '/messages',
      {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: { name: templateName, language: { code: 'en' }, components },
      },
      `template "${templateName}" to ${to}`,
    );
    if (result) this.logger.log(`✅ WhatsApp template "${templateName}" sent to ${to}`);
    return !!result;
  }

  /** Uploads a document to Meta's /media endpoint, returning the media id (or null on failure). */
  private async uploadMedia(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    context: string,
  ): Promise<string | null> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([Uint8Array.from(buffer)], { type: mimeType }), filename);

    const result = await this.postGraph('/media', form, context);
    return (result?.['id'] as string) ?? null;
  }

  /**
   * Shared POST helper for every outbound Graph API call.
   * - Every call is wrapped in a 12s AbortController timeout, cleared in `finally`.
   *   Timeouts are NEVER retried — Meta's response never arrived, so it's ambiguous
   *   whether the request was already processed; retrying risks a duplicate
   *   WhatsApp message landing on a customer's phone.
   * - Retries (max 2, backoff 500ms/1500ms) apply only to HTTP 429/5xx, which
   *   Meta's docs guarantee mean the request was NOT processed.
   * - Non-2xx responses have their Graph API error body parsed and logged with
   *   full context (status/code/subcode/message/fbtrace_id) so failures are
   *   diagnosable instead of a bare `false`.
   */
  private async postGraph(path: string, body: unknown, context: string): Promise<Record<string, unknown> | null> {
    const url = `${this.baseUrl}${path}`;
    const isForm = body instanceof FormData;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            ...(isForm ? {} : { 'Content-Type': 'application/json' }),
          },
          body: isForm ? (body as FormData) : JSON.stringify(body),
          signal: controller.signal,
        });

        if (res.ok) {
          return await res.json().catch(() => ({}));
        }

        const errorBody: any = await res.json().catch(() => null);
        const graphError = errorBody?.error;
        this.logger.error(
          `WhatsApp Graph API error (${context}): status=${res.status} code=${graphError?.code} ` +
            `subcode=${graphError?.error_subcode} message="${graphError?.message}" fbtrace_id=${graphError?.fbtrace_id}`,
        );

        const retriable = res.status === 429 || res.status >= 500;
        if (retriable && attempt < MAX_RETRIES) {
          await this.sleep(RETRY_BACKOFF_MS[attempt] ?? 1500);
          continue;
        }
        return null;
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          this.logger.error(
            `WhatsApp request timed out after ${TIMEOUT_MS}ms (${context}) — not retried (delivery status unknown, avoiding duplicate send)`,
          );
        } else {
          this.logger.error(`WhatsApp request failed (${context}): ${err?.message ?? err}`);
        }
        return null;
      } finally {
        clearTimeout(timer);
      }
    }
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
