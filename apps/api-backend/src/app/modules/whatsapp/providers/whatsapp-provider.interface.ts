export interface IWhatsAppProvider {
  sendMessage(phone: string, message: string): Promise<boolean>;
  sendDocument(phone: string, pdfBuffer: Buffer, filename: string, caption?: string): Promise<boolean>;
  isReady(): boolean;
  getQr(): string | null;
  logout(): Promise<void>;
}

export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER';
