import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { DamageSeverity } from '@prisma/client';

export class ReportDamageCaseDto {
  @IsUUID()
  customerId: string;

  @IsUUID()
  productId: string;

  @IsOptional()
  @IsUUID()
  dailySheetItemId?: string;

  @IsEnum(DamageSeverity)
  severity: DamageSeverity;

  @IsInt()
  @Min(1)
  bottleCount: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(0)
  photoKeys: string[];
}
