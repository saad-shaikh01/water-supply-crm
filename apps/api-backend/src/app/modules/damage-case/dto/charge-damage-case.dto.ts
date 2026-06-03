import { IsEnum, IsInt, IsNumber, IsOptional, IsPositive, IsString, MaxLength, Min } from 'class-validator';
import { WriteOffCategory } from '@prisma/client';

export class ChargeDamageCaseDto {
  @IsPositive()
  @IsNumber({ maxDecimalPlaces: 2 })
  chargeAmount: number;

  @IsEnum(WriteOffCategory)
  writeOffCategory: WriteOffCategory;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reviewNote?: string;

  @IsInt()
  @Min(0)
  version: number;
}
