import { IsUUID, IsNumber, IsOptional, IsString, IsEnum, Min } from 'class-validator';
import { PaymentMode } from '@prisma/client';

export class RecordPaymentDto {
  @IsUUID()
  customerId!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  description?: string;

  /** How the money arrived. Defaults to CASH when omitted. */
  @IsOptional()
  @IsEnum(PaymentMode)
  paymentMode?: PaymentMode;

  @IsOptional()
  @IsUUID()
  paymentRequestId?: string;
}
