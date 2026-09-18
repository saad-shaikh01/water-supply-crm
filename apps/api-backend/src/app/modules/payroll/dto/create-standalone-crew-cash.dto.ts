import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { CrewCashCategory } from '@prisma/client';

/**
 * Records Crew Cash given to an employee WITHOUT a Daily Sheet (owner-requested
 * 2026-09-18) — e.g. no open route sheet that day. Single-step (no
 * PENDING/APPROVED gate of its own): it counts against the Office Cash
 * Ledger's available balance immediately, same as CreateFuelCardTopUpDto.
 * `date` defaults to now when omitted; unlike CrewCashDistribution (locked to
 * the sheet's own date), there is no sheet to inherit a date from here.
 */
export class CreateStandaloneCrewCashDto {
  @IsUUID()
  employeeId: string;

  @IsEnum(CrewCashCategory)
  category: CrewCashCategory;

  /** Whole positive rupees only — a magnitude, never signed (mirrors CrewCashDistribution.amount). */
  @IsInt()
  @Min(1)
  amount: number;

  @IsOptional()
  @IsDateString()
  date?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
