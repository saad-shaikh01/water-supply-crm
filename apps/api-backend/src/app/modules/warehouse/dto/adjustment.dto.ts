import { IsInt, IsOptional, IsString, IsUUID } from 'class-validator';

export class AdjustmentDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  filledAdjust!: number;

  @IsInt()
  emptyAdjust!: number;

  @IsInt()
  damagedAdjust!: number;

  @IsInt()
  leakedAdjust!: number;

  @IsString()
  notes!: string;
}
