import { IsDateString, IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

/**
 * A manually-recorded cash-in event outside the normal driver-handover flow —
 * see VanCashLedgerService.addManualCashIn. `vanId` is optional: set it to
 * anchor the entry to one van's balance, or omit it for a general/office-wide
 * entry (only visible in the vendor-wide "All Vans" view).
 */
export class AddCashInDto {
  @IsOptional()
  @IsUUID()
  vanId?: string;

  @IsNumber()
  @Min(0)
  openingBalance: number;

  @IsDateString()
  openingDate: string;

  @IsOptional()
  @IsString()
  note?: string;
}
