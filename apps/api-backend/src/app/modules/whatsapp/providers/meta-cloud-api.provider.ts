import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IWhatsAppProvider, ListTemplatesResult, MetaTemplateRecord, PhoneNumberInfoResult, WhatsAppCredentials } from './whatsapp-provider.interface';
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

  /** The credentials a call runs with: the given sender's, or (when omitted) the platform env ones. */
  private creds(c?: WhatsAppCredentials): Required<WhatsAppCredentials> {
    return c
      ? { accessToken: c.accessToken, phoneNumberId: c.phoneNumberId, apiVersion: c.apiVersion ?? this.apiVersion }
      : { accessToken: this.accessToken, phoneNumberId: this.phoneNumberId, apiVersion: this.apiVersion };
  }

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

  isReady(creds?: WhatsAppCredentials): boolean {
    const c = this.creds(creds);
    return this.enabled && !!c.accessToken && !!c.phoneNumberId;
  }

  async fetchPhoneNumberInfo(creds: WhatsAppCredentials): Promise<PhoneNumberInfoResult> {
    const c = this.creds(creds);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://graph.facebook.com/${c.apiVersion}/${encodeURIComponent(c.phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
        { headers: { Authorization: `Bearer ${c.accessToken}` }, signal: controller.signal },
      );
      const body: any = await res.json().catch(() => null);
      if (res.ok) {
        return {
          ok: true,
          displayNumber: body?.display_phone_number ?? null,
          verifiedName: body?.verified_name ?? null,
          qualityRating: body?.quality_rating ?? null,
        };
      }
      return { ok: false, status: res.status, code: body?.error?.code ?? null, message: String(body?.error?.message ?? `HTTP ${res.status}`).slice(0, 300) };
    } catch (err: any) {
      return { ok: false, status: 0, code: null, message: err?.name === 'AbortError' ? 'Timed out reaching WhatsApp' : String(err?.message ?? err).slice(0, 300) };
    } finally {
      clearTimeout(timer);
    }
  }

  async listTemplates(creds: WhatsAppCredentials, wabaId: string): Promise<ListTemplatesResult> {
    const c = this.creds(creds);
    const templates: MetaTemplateRecord[] = [];
    let url: string | null =
      `https://graph.facebook.com/${c.apiVersion}/${encodeURIComponent(wabaId)}/message_templates?fields=name,language,category,status,rejected_reason&limit=200`;
    for (let page = 0; url && page < 10; page++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${c.accessToken}` }, signal: controller.signal });
        const body: any = await res.json().catch(() => null);
        if (!res.ok) {
          return { ok: false, status: res.status, code: body?.error?.code ?? null, message: String(body?.error?.message ?? `HTTP ${res.status}`).slice(0, 300) };
        }
        for (const t of body?.data ?? []) {
          templates.push({
            name: String(t.name),
            language: String(t.language ?? 'en'),
            category: t.category ?? null,
            status: String(t.status ?? 'UNKNOWN'),
            rejectedReason: t.rejected_reason && t.rejected_reason !== 'NONE' ? String(t.rejected_reason) : null,
          });
        }
        url = body?.paging?.next ?? null;
      } catch (err: any) {
        return { ok: false, status: 0, code: null, message: err?.name === 'AbortError' ? 'Timed out reaching WhatsApp' : String(err?.message ?? err).slice(0, 300) };
      } finally {
        clearTimeout(timer);
      }
    }
    return { ok: true, templates };
  }

  async sendMessage(phone: string, message: string, creds?: WhatsAppCredentials): Promise<boolean> {
    if (!this.isReady(creds)) return false;
    const to = normalizePhone(phone);
    const result = await this.postGraph(
      '/messages',
      { messaging_product: 'whatsapp', to, type: 'text', text: { body: message } },
      `text message to ${to}`,
      creds,
    );
    if (result) this.logger.log(`✅ WhatsApp text sent to ${to}`);
    return !!result;
  }

  async sendDocument(
    phone: string,
    pdfBuffer: Buffer,
    filename: string,
    caption?: string,
    creds?: WhatsAppCredentials,
  ): Promise<boolean> {
    if (!this.isReady(creds)) return false;
    const to = normalizePhone(phone);

    const mediaId = await this.uploadMedia(pdfBuffer, filename, 'application/pdf', `document upload for ${to}`, creds);
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
      creds,
    );
    if (result) this.logger.log(`✅ WhatsApp document sent to ${to}: ${filename}`);
    return !!result;
  }

  async sendTemplate(
    phone: string,
    templateName: string,
    bodyParams: string[],
    document?: { buffer: Buffer; filename: string },
    imageUrl?: string,
    creds?: WhatsAppCredentials,
  ): Promise<boolean> {
    if (!this.isReady(creds)) return false;
    const to = normalizePhone(phone);

    let mediaId: string | null = null;
    if (document) {
      mediaId = await this.uploadMedia(document.buffer, document.filename, 'application/pdf', `template media for ${to}`, creds);
      if (!mediaId) return false;
    }

    const components: Array<Record<string, unknown>> = [];
    if (mediaId && document) {
      components.push({
        type: 'header',
        parameters: [{ type: 'document', document: { id: mediaId, filename: document.filename } }],
      });
    } else if (imageUrl) {
      // Image header by link — Meta fetches the URL itself, no upload round-trip needed.
      // Caller must pass a URL that's fetchable for at least a few minutes (a short-lived
      // signed URL is fine; it's used once, right after generation).
      components.push({
        type: 'header',
        parameters: [{ type: 'image', image: { link: imageUrl } }],
      });
    }

    // Meta rejects empty-string template variables outright — coerce falsy values.
    // It also rejects (#132012) variables containing newlines, tabs or 4+ consecutive
    // spaces, so collapse all whitespace runs (customer names are free-text).
    const safeParams = bodyParams.map((p) => {
      const clean = p ? String(p).replace(/\s+/g, ' ').trim() : '';
      return clean || '-';
    });
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
      creds,
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
    creds?: WhatsAppCredentials,
  ): Promise<string | null> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', new Blob([Uint8Array.from(buffer)], { type: mimeType }), filename);

    const result = await this.postGraph('/media', form, context, creds);
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
  private async postGraph(path: string, body: unknown, context: string, creds?: WhatsAppCredentials): Promise<Record<string, unknown> | null> {
    const c = this.creds(creds);
    const url = `https://graph.facebook.com/${c.apiVersion}/${c.phoneNumberId}${path}`;
    const isForm = body instanceof FormData;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${c.accessToken}`,
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
            `subcode=${graphError?.error_subcode} message="${graphError?.message}" ` +
            `details="${graphError?.error_data?.details}" fbtrace_id=${graphError?.fbtrace_id}`,
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
