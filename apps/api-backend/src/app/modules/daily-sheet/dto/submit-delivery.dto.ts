import { IsEnum, IsInt, IsNumber, IsOptional, IsString, IsUrl, Min } from 'class-validator';
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

  @IsNumber()
  @Min(0)
  cashCollected!: number;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsUrl()
  photoUrl?: string;
}
