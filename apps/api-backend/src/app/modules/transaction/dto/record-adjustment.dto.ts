import { IsUUID, IsNumber, IsOptional, IsString, IsInt } from 'class-validator';

export class RecordAdjustmentDto {
  @IsUUID()
  customerId!: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsOptional()
  @IsNumber()
  amount?: number;

  @IsOptional()
  @IsInt()
  bottleCount?: number;

  @IsString()
  description!: string;
}
