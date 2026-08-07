import { IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
import { CrewCashCategory } from '@prisma/client';

/**
 * Post-sync correction (docs/features/crew-operational-cash-distribution.md
 * §9) for an already-synced `CrewCashDistribution` row — reason is mandatory
 * (mirrors `VoidStaffLedgerEntryDto`/`ReverseStaffLedgerEntryDto`/
 * `CorrectStaffLedgerEntryDto`'s own required `reason`). At least one of
 * `newEmployeeId`/`newCategory`/`newAmount` must be provided — a correction
 * that changes nothing is not a correction (enforced in the service, not
 * expressible as a class-validator decorator across three independent
 * optional fields).
 */
export class CorrectCrewCashDistributionDto {
  @IsOptional()
  @IsUUID()
  newEmployeeId?: string;

  @IsOptional()
  @IsEnum(CrewCashCategory)
  newCategory?: CrewCashCategory;

  @IsOptional()
  @IsInt()
  @Min(1)
  newAmount?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
