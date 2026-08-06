import { IsArray, IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { PayFrequency } from '@prisma/client';

export class CreateSalaryStructureDto {
  @IsUUID()
  userId: string;

  /** Whole positive rupees only — no fractional currency in this business. */
  @IsInt()
  @Min(1)
  baseAmount: number;

  @IsOptional()
  @IsEnum(PayFrequency)
  payFrequency?: PayFrequency;

  @IsDateString()
  effectiveFrom: string;

  /**
   * Reserved for future standing allowances, e.g. [{label, amount}]. No
   * logic consumes this in Phase 1 (see schema module note) — validated only
   * loosely here since its shape is not yet fixed.
   */
  @IsOptional()
  @IsArray()
  recurringLineItems?: Array<Record<string, unknown>>;
}
