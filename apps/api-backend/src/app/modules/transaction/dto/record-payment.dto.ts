import { IsUUID, IsNumber, IsOptional, IsString, IsEnum, IsDateString, Min } from 'class-validator';
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

  /**
   * The date the payment was actually collected (YYYY-MM-DD or ISO). Must be
   * today or earlier — future dates are rejected by the service. Omit (or
   * pass today's date) to record it with the live timestamp as before; a past
   * date backdates the transaction's `createdAt`, so it lands in the correct
   * month's statement/ledger instead of today's.
   */
  @IsOptional()
  @IsDateString()
  date?: string;
}
