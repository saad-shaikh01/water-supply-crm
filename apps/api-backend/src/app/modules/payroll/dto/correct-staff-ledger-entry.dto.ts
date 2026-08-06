import { IsInt, IsNotEmpty, IsString, MaxLength, Min, NotEquals } from 'class-validator';

export class CorrectStaffLedgerEntryDto {
  /** Optimistic-concurrency token — must match the entry's current `version`. */
  @IsInt()
  @Min(0)
  version: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;

  /** The intended correct signed amount, replacing the mistaken original. */
  @IsInt()
  @NotEquals(0)
  correctedAmount: number;
}
