import { IsDateString, IsEnum, IsNumber, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';
import { ProductCostKind } from '@prisma/client';

/**
 * Add / backdated-insert a ProductCost row (design doc §4.1). `note` is
 * optional at the DTO layer — the service enforces it is mandatory
 * specifically when this insert trims an existing row (a true backdated
 * correction, not a plain forward-dated new rate).
 */
export class CreateProductCostDto {
  @IsUUID()
  productId: string;

  /** Which cost stream this row belongs to (2026-09-22, caps as a separate
   *  cost). Optional — omitted defaults to `BOTTLE` (the original/only kind)
   *  so any caller not yet aware of `kind` keeps working unchanged. */
  @IsOptional()
  @IsEnum(ProductCostKind)
  kind?: ProductCostKind;

  @IsNumber()
  @Min(0.01)
  costPerUnit: number;

  @IsDateString()
  effectiveFrom: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  invoiceRef?: string;
}
