import { IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';

export class ReverseStaffLedgerEntryDto {
  /** Optimistic-concurrency token — must match the entry's current `version`. */
  @IsInt()
  @Min(0)
  version: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
