import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CustomerActivationService } from './customer-activation.service';
import { CheckEligibilityDto } from './dto/check-eligibility.dto';
import { ActivateDto } from './dto/activate.dto';
import { Public } from '../../common/decorators/public.decorator';

// Stricter than /auth/login: this is an identity-verification oracle (customer code +
// phone, no rotating secret) rather than a password check, and it can create/mutate a
// User record. Mirrors /auth/forgot-password's tiers rather than /auth/login's.
const ACTIVATION_THROTTLE = {
  short: { ttl: 1000, limit: 1 },
  medium: { ttl: 60000, limit: 3 },
  long: { ttl: 3600000, limit: 10 },
};

@Controller('customer-activation')
export class CustomerActivationController {
  constructor(private readonly activationService: CustomerActivationService) {}

  @Post('check-eligibility')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(ACTIVATION_THROTTLE)
  checkEligibility(@Body() dto: CheckEligibilityDto) {
    return this.activationService.checkEligibility(dto);
  }

  @Post('activate')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(ACTIVATION_THROTTLE)
  activate(@Body() dto: ActivateDto) {
    return this.activationService.activate(dto);
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle(ACTIVATION_THROTTLE)
  resetPassword(@Body() dto: ActivateDto) {
    return this.activationService.resetPassword(dto);
  }
}
