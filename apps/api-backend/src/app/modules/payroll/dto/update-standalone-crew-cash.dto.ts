import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { CrewCashCategory } from '@prisma/client';

/**
 * Edits a Standalone Crew Cash entry in place (Cash Ledger P2). Every field
 * except `version` and `reason` is optional, but at least one must actually
 * differ from the stored row (enforced in the service). Only allowed while the
 * entry's payroll twin has not been rolled into a locked payroll period.
 * Mirrors `UpdateStandaloneCrewCashData` in the vendor-dashboard crew-cash API.
 */
export class UpdateStandaloneCrewCashDto {
  /** Optimistic-concurrency token — must match the entry's current `version`. */
  @IsInt()
  @Min(0)
  version: number;

  @IsOptional()
  @IsUUID()
  employeeId?: string;

  @IsOptional()
  @IsEnum(CrewCashCategory)
  category?: CrewCashCategory;

  /** Whole positive rupees only — a magnitude, never signed. */
  @IsOptional()
  @IsInt()
  @Min(1)
  amount?: number;

  /** YYYY-MM-DD or ISO. Future (Asia/Karachi) dates are rejected by the service. */
  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  /** Mandatory human reason — kept with before/after in the audit trail. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
