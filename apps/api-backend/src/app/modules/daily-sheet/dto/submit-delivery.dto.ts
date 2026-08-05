import { IsBoolean, IsEnum, IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';
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
}
