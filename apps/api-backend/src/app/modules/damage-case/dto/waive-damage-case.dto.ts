import { IsEnum, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import { WriteOffCategory } from '@prisma/client';

export class WaiveDamageCaseDto {
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
