import { IsEnum, IsNumber, IsPositive, IsString, IsOptional, MinLength } from 'class-validator';
import { PaymentMethod } from '@prisma/client';

const MANUAL_METHODS = [
  PaymentMethod.MANUAL_RAAST,
  PaymentMethod.MANUAL_JAZZCASH,
  PaymentMethod.MANUAL_EASYPAISA,
  PaymentMethod.MANUAL_BANK,
];

export class SubmitManualPaymentDto {
  @IsNumber()
  @IsPositive()
  amount!: number;

  @IsEnum(MANUAL_METHODS, {
    message: `method must be one of: ${MANUAL_METHODS.join(', ')}`,
  })
  method!: PaymentMethod;

  /** Transaction reference number / JazzCash TID / Easypaisa ref */
  @IsString()
  @MinLength(4)
  referenceNo!: string;

  @IsOptional()
  @IsString()
  customerNote?: string;
  // screenshot is uploaded as multipart file — not a DTO field
}
