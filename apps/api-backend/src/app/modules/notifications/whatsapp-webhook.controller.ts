import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  RawBodyRequest,
  Req,
  ServiceUnavailableException,
  BadRequestException,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { MaintenanceExempt } from '../platform-settings/maintenance-exempt.decorator';
import { WhatsAppStatusService } from './whatsapp-status.service';
import { safeEqual, verifyMetaSignature } from './whatsapp-webhook.util';

/**
 * Meta WhatsApp webhook — no JWT (Meta calls it), so every request is authenticated here instead:
 *  - GET  : Meta's one-time subscription handshake, checked against META_WA_WEBHOOK_VERIFY_TOKEN.
 *  - POST : delivery reports, checked against the X-Hub-Signature-256 HMAC (keyed by META_WA_APP_SECRET)
 *           of the RAW request body. Unsigned or wrongly signed requests are rejected and change nothing.
 *
 * Configure in Meta → App → WhatsApp → Configuration:
 *   Callback URL  https://<api-domain>/api/webhooks/whatsapp
 *   Verify token  the value of META_WA_WEBHOOK_VERIFY_TOKEN
 *   Webhook field `messages` (subscribe)
 *
 * Not throttled and exempt from maintenance mode: Meta delivers reports in bursts and retries refusals for days.
 */
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(private readonly statuses: WhatsAppStatusService) {}

  @Get()
  @Public()
  @MaintenanceExempt()
  @SkipThrottle()
  verify(
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') token?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    const expected = process.env['META_WA_WEBHOOK_VERIFY_TOKEN'];
    if (mode === 'subscribe' && expected && safeEqual(token, expected) && challenge) return challenge;
    throw new ForbiddenException();
  }

  @Post()
  @Public()
  @MaintenanceExempt()
  @SkipThrottle()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: unknown,
  ) {
    const secret = process.env['META_WA_APP_SECRET'];
    if (!secret) {
      this.logger.warn('WhatsApp webhook called but META_WA_APP_SECRET is not set — refusing (cannot verify the signature)');
      throw new ServiceUnavailableException();
    }
    if (!req.rawBody) throw new BadRequestException('Raw body unavailable');
    if (!verifyMetaSignature(req.rawBody, signature, secret)) {
      this.logger.warn('WhatsApp webhook rejected: bad or missing signature');
      throw new ForbiddenException();
    }

    const matched = await this.statuses.handle(body);
    return { received: true, matched };
  }
}
