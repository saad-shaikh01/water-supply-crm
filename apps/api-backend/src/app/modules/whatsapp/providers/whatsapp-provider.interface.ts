/**
 * Credentials of one WhatsApp Cloud API sender. When omitted, the provider uses the platform
 * (env-level) credentials — the legacy single-number setup that Blue Ice still runs on.
 */
export interface WhatsAppCredentials {
  accessToken: string;
  phoneNumberId: string;
  apiVersion?: string;
}

export type PhoneNumberInfoResult =
  | { ok: true; displayNumber: string | null; verifiedName: string | null; qualityRating: string | null }
  | { ok: false; status: number; code: number | null; message: string };

export interface MetaTemplateRecord {
  name: string;
  language: string;
  category: string | null;
  status: string;
  rejectedReason: string | null;
}

export type ListTemplatesResult =
  | { ok: true; templates: MetaTemplateRecord[] }
  | { ok: false; status: number; code: number | null; message: string };

export interface IWhatsAppProvider {
  sendMessage(phone: string, message: string, creds?: WhatsAppCredentials): Promise<boolean>;
  sendDocument(phone: string, pdfBuffer: Buffer, filename: string, caption?: string, creds?: WhatsAppCredentials): Promise<boolean>;
  sendTemplate(
    phone: string,
    templateName: string,
    bodyParams: string[],
    document?: { buffer: Buffer; filename: string },
    // Alternative header media: a publicly-fetchable URL (e.g. a short-lived Wasabi
    // signed URL) sent as an Image header component — used instead of `document`
    // when there's already a stored file and no in-memory buffer to upload.
    // Never pass both — a template's header type is fixed to one kind.
    imageUrl?: string,
    creds?: WhatsAppCredentials,
  ): Promise<boolean>;
  /** Platform credentials by default; pass `creds` to ask about a specific sender. */
  isReady(creds?: WhatsAppCredentials): boolean;
  /** Reads the sender's own phone-number record (token + number id validity, display number, quality rating). */
  fetchPhoneNumberInfo(creds: WhatsAppCredentials): Promise<PhoneNumberInfoResult>;
  /** Reads the message templates (name + review status) of a WhatsApp Business Account. Read-only. */
  listTemplates(creds: WhatsAppCredentials, wabaId: string): Promise<ListTemplatesResult>;
}

export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER';
