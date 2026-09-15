import { IsDateString, IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/**
 * Records a top-up on a FuelCard — office cash -> fuel card. Single-step (no
 * PENDING/APPROVED gate): it counts against the Office Cash Ledger's
 * available balance immediately. `attachmentKey` is a Wasabi object key
 * returned by `POST /fuel-cards/:id/top-ups/attachment`, uploaded first (same
 * two-step pattern as Office Cash Remittance's deposit-slip upload).
 */
export class CreateFuelCardTopUpDto {
  @IsNumber()
  @Min(0.01)
  amount: number;

  @IsDateString()
  date: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  attachmentKey?: string;
}
