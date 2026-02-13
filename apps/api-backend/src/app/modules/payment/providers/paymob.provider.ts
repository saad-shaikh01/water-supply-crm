import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import {
  IPaymentProvider,
  RaastQrResult,
  GatewayWebhookPayload,
} from './payment-provider.interface';

/**
 * Paymob Pakistan — Raast QR integration
 *
 * Required env vars:
 *   PAYMOB_API_KEY             — From Paymob dashboard → Settings → API Keys
 *   PAYMOB_RAAST_INTEGRATION_ID — From Paymob dashboard → Payment Integrations → Raast
 *   PAYMOB_HMAC_SECRET         — From Paymob dashboard → Settings → HMAC Secret
 *   PAYMOB_BASE_URL            — https://accept.paymob.com/api (default)
 *
 * Setup steps:
 *  1. Register at https://paymob.com/pk
 *  2. Complete business verification (1-2 weeks)
 *  3. Enable "Raast" payment method in your account
 *  4. Copy the 4 values above into your .env
 *
 * How it works:
 *  1. We call Paymob API → get checkout URL
 *  2. Customer opens checkout URL → scans Raast QR from any banking app
 *  3. Paymob sends webhook to POST /api/webhooks/paymob
 *  4. We verify HMAC → record payment automatically
 */
@Injectable()
export class PaymobProvider implements IPaymentProvider {
  private readonly logger = new Logger(PaymobProvider.name);

  private readonly apiKey = process.env['PAYMOB_API_KEY'] ?? '';
  private readonly raastIntegrationId = process.env['PAYMOB_RAAST_INTEGRATION_ID'] ?? '';
  private readonly hmacSecret = process.env['PAYMOB_HMAC_SECRET'] ?? '';
  private readonly baseUrl = process.env['PAYMOB_BASE_URL'] ?? 'https://accept.paymob.com/api';
  private readonly callbackUrl = `${process.env['API_URL'] ?? 'http://localhost:3000/api'}/webhooks/paymob`;

  async createRaastQr(params: {
    orderId: string;
    amountPkr: number;
    customerName: string;
    customerPhone: string;
    description: string;
  }): Promise<RaastQrResult> {
    if (!this.apiKey || !this.raastIntegrationId) {
      this.logger.warn('Paymob credentials not configured — returning mock QR');
      return this.mockQrResult(params.orderId, params.amountPkr);
    }

    try {
      // Step 1: Auth token
      const authRes = await fetch(`${this.baseUrl}/auth/tokens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: this.apiKey }),
      });
      const authData = (await authRes.json()) as any;
      const token: string = authData.token;

      // Step 2: Create order
      const orderRes = await fetch(`${this.baseUrl}/ecommerce/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          amount_cents: Math.round(params.amountPkr * 100),
          currency: 'PKR',
          merchant_order_id: params.orderId,
          items: [
            {
              name: params.description,
              amount_cents: Math.round(params.amountPkr * 100),
              description: params.description,
              quantity: 1,
            },
          ],
        }),
      });
      const orderData = (await orderRes.json()) as any;
      const gatewayOrderId: string = String(orderData.id);

      // Step 3: Payment key
      const payKeyRes = await fetch(`${this.baseUrl}/ecommerce/payment_keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          auth_token: token,
          amount_cents: Math.round(params.amountPkr * 100),
          expiration: 900, // 15 minutes
          order_id: gatewayOrderId,
          currency: 'PKR',
          integration_id: Number(this.raastIntegrationId),
          billing_data: {
            first_name: params.customerName.split(' ')[0] || params.customerName,
            last_name: params.customerName.split(' ')[1] || 'N/A',
            phone_number: params.customerPhone,
            email: 'customer@watercrm.pk',
            apartment: 'N/A',
            floor: 'N/A',
            street: 'N/A',
            building: 'N/A',
            shipping_method: 'N/A',
            postal_code: 'N/A',
            city: 'N/A',
            country: 'PK',
            state: 'N/A',
          },
          lock_order_when_paid: true,
        }),
      });
      const payKeyData = (await payKeyRes.json()) as any;
      const paymentKey: string = payKeyData.token;

      const checkoutUrl = `https://accept.paymob.com/api/acceptance/iframes/${this.raastIntegrationId}?payment_token=${paymentKey}`;
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 min

      this.logger.log(`Paymob order created: ${gatewayOrderId} for Rs.${params.amountPkr}`);

      return { gatewayOrderId, checkoutUrl, expiresAt };
    } catch (err) {
      this.logger.error(`Paymob QR creation failed: ${err}`);
      // Fallback to mock so development still works
      return this.mockQrResult(params.orderId, params.amountPkr);
    }
  }

  verifyWebhook(payload: any, hmacHeader: string): GatewayWebhookPayload | null {
    if (!this.hmacSecret) {
      this.logger.warn('PAYMOB_HMAC_SECRET not set — skipping signature verification');
    } else {
      // Paymob HMAC: concatenate these specific fields in order, HMAC-SHA512
      const fields = [
        payload.amount_cents,
        payload.created_at,
        payload.currency,
        payload.error_occured,
        payload.has_parent_transaction,
        payload.id,
        payload.integration_id,
        payload.is_3d_secure,
        payload.is_auth,
        payload.is_capture,
        payload.is_refunded,
        payload.is_standalone_payment,
        payload.is_voided,
        payload.order?.id,
        payload.owner,
        payload.pending,
        payload.source_data?.pan,
        payload.source_data?.sub_type,
        payload.source_data?.type,
        payload.success,
      ];
      const concatenated = fields.map((f) => String(f ?? '')).join('');
      const expected = crypto
        .createHmac('sha512', this.hmacSecret)
        .update(concatenated)
        .digest('hex');

      if (expected.toLowerCase() !== (hmacHeader ?? '').toLowerCase()) {
        this.logger.warn('Paymob HMAC verification failed');
        return null;
      }
    }

    if (!payload.success || payload.pending) return null;

    return {
      gatewayOrderId: String(payload.order?.id ?? ''),
      gatewayTxId: String(payload.id ?? ''),
      success: payload.success === true || payload.success === 'true',
      amountCents: Number(payload.amount_cents ?? 0),
      rawPayload: payload,
    };
  }

  /** Returns a mock result for development (when Paymob not configured) */
  private mockQrResult(orderId: string, amountPkr: number): RaastQrResult {
    return {
      gatewayOrderId: `MOCK-${orderId}`,
      checkoutUrl: `http://localhost:3000/mock-checkout?order=${orderId}&amount=${amountPkr}`,
      qrCodeData: `mock-qr-data-${orderId}`,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    };
  }
}
