import {
  Controller,
  Post,
  Body,
  Headers,
  HttpCode,
  Logger,
} from '@nestjs/common';
import { PaymentService } from './payment.service';

/**
 * Webhook controller — NO JWT auth (called by payment gateways)
 * Paymob sends a POST request here when a payment is completed.
 *
 * Configure in Paymob dashboard:
 *   Settings → Callback → URL: https://yourdomain.com/api/webhooks/paymob
 *   Transaction Callback URL: same
 *
 * IMPORTANT: This endpoint is public — always verify HMAC signature inside.
 */
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly paymentService: PaymentService) {}

  @Post('paymob')
  @HttpCode(200)
  async handlePaymob(
    @Body() payload: any,
    @Headers('hmac') hmacHeader: string,
  ) {
    this.logger.log(`Paymob webhook received: ${JSON.stringify(payload?.id)}`);
    return this.paymentService.handlePaymobWebhook(payload, hmacHeader ?? '');
  }
}
