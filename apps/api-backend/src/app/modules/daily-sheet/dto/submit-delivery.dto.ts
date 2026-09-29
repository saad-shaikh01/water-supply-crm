import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { DeliveryStatus } from '@prisma/client';

export class SubmitDeliveryDto {
  @IsEnum(DeliveryStatus)
  status!: DeliveryStatus;

  @IsInt()
  @Min(0)
  filledDropped!: number;

  @IsInt()
  @Min(0)
  emptyReceived!: number;

  // Already-filled bottles received back from the customer (account closing,
  // excess stock return) — separate count from emptyReceived, no refill needed.
  @IsInt()
  @Min(0)
  filledReceived!: number;

  @IsNumber()
  @Min(0)
  cashCollected!: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  failureCategory?: string;

  @IsOptional()
  @IsString()
  photoKey?: string;

  @IsOptional()
  @IsBoolean()
  forceResubmit?: boolean;

  // Customer Deposits (owner-requested 2026-09-29) — a driver collecting/
  // returning a security deposit at this stop. Entirely separate from
  // cashCollected/emptyReceived above: posted to CustomerDeposit via its own
  // CustomerDepositEntry, never touching financialBalance/BottleWallet. All
  // optional/default 0 so vendors who don't use deposits are unaffected.
  @IsOptional()
  @IsNumber()
  @Min(0)
  depositCashCollected?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  depositBottlesCollected?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  depositBottlesReturned?: number;

  /** Required when depositBottlesCollected or depositBottlesReturned is set. */
  @IsOptional()
  @IsUUID()
  depositProductId?: string;
}
