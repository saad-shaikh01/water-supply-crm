import { IsDateString, IsNumber, IsUUID, Min } from 'class-validator';

/** Upserted on `vanId` — see VanCashLedgerService.setOpeningBalance. */
export class SetOpeningBalanceDto {
  @IsUUID()
  vanId: string;

  @IsNumber()
  @Min(0)
  openingBalance: number;

  @IsDateString()
  openingDate: string;
}
