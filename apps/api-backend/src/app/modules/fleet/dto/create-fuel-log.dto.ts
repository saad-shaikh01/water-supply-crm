import { IsUUID, IsOptional, IsDateString, IsInt, Min, IsNumber, IsBoolean, IsString, MaxLength } from 'class-validator';

export class CreateFuelLogDto {
  @IsUUID()
  vanId: string;

  @IsOptional()
  @IsUUID()
  dailySheetId?: string;

  @IsDateString()
  date: string;

  @IsInt()
  @Min(0)
  odometerAtFill: number;

  @IsNumber()
  @Min(0.1)
  litersFilled: number;

  @IsNumber()
  @Min(0)
  amountPaid: number;

  @IsOptional()
  @IsBoolean()
  isFullTank?: boolean;

  // Whether this fill was paid out of the driver's van cash-in-hand
  // (default true — most fills are). Set false when paid by card, bank
  // transfer, or a company account not routed through the driver's
  // collected cash — those fills must NOT reduce the cash hand-in.
  @IsOptional()
  @IsBoolean()
  paidFromCash?: boolean;

  @IsOptional() @IsString() @MaxLength(150) fuelStation?: string;
  @IsOptional() @IsString() receiptPhotoKey?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
