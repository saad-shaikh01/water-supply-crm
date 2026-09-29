import { Transform } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { DepositType } from '@prisma/client';

/** Collects a deposit from a customer — office manual entry (source = OFFICE). */
export class CollectDepositDto {
  @IsEnum(DepositType)
  type!: DepositType;

  /** Required (and only meaningful) when type = BOTTLE — checked in the service. */
  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsNumber()
  amount!: number;

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
