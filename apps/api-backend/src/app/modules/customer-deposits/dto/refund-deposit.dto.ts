import { Transform } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { DepositPaymentMethod } from '@prisma/client';

/** Refunds part or all of a CustomerDeposit's held balance back to the customer. */
export class RefundDepositDto {
  @IsNumber()
  amount!: number;

  /**
   * How the refund was paid out (CASH deposits only). Defaults to CASH. Only a CASH
   * refund leaves the office Cash Ledger; BANK_TRANSFER/ONLINE require `referenceNo`.
   */
  @IsOptional()
  @IsEnum(DepositPaymentMethod)
  paymentMethod?: DepositPaymentMethod;

  @IsOptional()
  @IsString()
  effectiveDate?: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  referenceNo?: string;
}
