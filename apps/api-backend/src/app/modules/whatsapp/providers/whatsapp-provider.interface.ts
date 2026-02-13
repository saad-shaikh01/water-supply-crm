export interface IWhatsAppProvider {
  sendMessage(phone: string, message: string): Promise<boolean>;
  isReady(): boolean;
}

export const WHATSAPP_PROVIDER = 'WHATSAPP_PROVIDER';
