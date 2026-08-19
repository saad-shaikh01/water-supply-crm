export interface IWhatsAppProvider {
  sendMessage(phone: string, message: string): Promise<boolean>;
  sendDocument(phone: string, pdfBuffer: Buffer, filename: string, caption?: string): Promise<boolean>;
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
  ): Promise<boolean>;
  isReady(): boolean;
}

export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER';
