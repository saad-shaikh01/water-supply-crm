import { IsInt, IsNotEmpty, IsString, IsUUID, MaxLength, Min } from 'class-validator';

/** `POST /payroll/ledger-entries/:id/defer` — charge this deduction in the NEXT payroll period instead. */
export class DeferLedgerEntryDto {
  /** The payroll period the entry is being deferred OUT of (the one currently showing it). */
  @IsUUID()
  periodId: string;

  /** Optimistic-concurrency token — must match the entry's current `version`. */
  @IsInt()
  @Min(0)
  version: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}

/** `POST /payroll/ledger-entries/:id/undo-defer` — put a deferred entry back in its original period. */
export class UndoDeferLedgerEntryDto {
  @IsInt()
  @Min(0)
  version: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
