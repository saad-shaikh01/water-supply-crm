export interface RaastQrResult {
  gatewayOrderId: string;
  checkoutUrl: string;
  qrCodeData?: string;   // base64 image or URL if gateway returns it
  expiresAt: Date;
}

export interface GatewayWebhookPayload {
  gatewayOrderId: string;
  gatewayTxId: string;
  success: boolean;
  amountCents: number;
  rawPayload: Record<string, any>;
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

export interface IPaymentProvider {
  /** Create a Raast QR payment session */
  createRaastQr(params: {
    orderId: string;    // our internal payment request ID
    amountPkr: number;
    customerName: string;
    customerPhone: string;
    description: string;
  }): Promise<RaastQrResult>;

  /** Verify and parse incoming webhook */
  verifyWebhook(
    payload: any,
    hmacHeader: string,
  ): GatewayWebhookPayload | null;
}
