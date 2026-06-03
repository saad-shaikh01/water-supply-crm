import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentType } from '@prisma/client';

export enum BulkPriceActionType {
  SET = 'SET',
  FLAT_INCREASE = 'FLAT_INCREASE',
  PERCENTAGE_INCREASE = 'PERCENTAGE_INCREASE',
}

export class BulkPriceFiltersDto {
  @IsUUID()
  @IsNotEmpty()
  productId: string;

  @IsNumber()
  @Min(0)
  @IsOptional()
  priceFrom?: number;

  @IsNumber()
  @Min(0)
  @IsOptional()
  priceTo?: number;

  @IsString()
  @IsOptional()
  area?: string;

  @IsUUID()
  @IsOptional()
  vanId?: string;

  @IsEnum(PaymentType)
  @IsOptional()
  billingType?: PaymentType;
}

export class BulkPriceActionDto {
  @IsEnum(BulkPriceActionType)
  @IsNotEmpty()
  type: BulkPriceActionType;

  @IsNumber()
  @Min(0)
  value: number;
}

export class BulkPricePreviewDto extends BulkPriceFiltersDto {}

export class BulkPriceUpdateDto {
  @ValidateNested()
  @Type(() => BulkPriceFiltersDto)
  filters: BulkPriceFiltersDto;

  @ValidateNested()
  @Type(() => BulkPriceActionDto)
  action: BulkPriceActionDto;
}
