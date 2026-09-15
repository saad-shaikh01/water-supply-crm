import { IsOptional, IsDateString, IsInt, Min, IsNumber, IsBoolean, IsString, IsUUID, MaxLength } from 'class-validator';

export class UpdateFuelLogDto {
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsInt() @Min(0) odometerAtFill?: number;
  @IsOptional() @IsNumber() @Min(0.1) litersFilled?: number;
  @IsOptional() @IsNumber() @Min(0) amountPaid?: number;
  @IsOptional() @IsBoolean() isFullTank?: boolean;
  @IsOptional() @IsBoolean() paidFromCash?: boolean;
  // Fuel Card Wallet (owner-requested 2026-09-15) — see CreateFuelLogDto.
  // Pass null explicitly to clear a previously-set card (e.g. switching a fill
  // back to plain cash/bank).
  @IsOptional() @IsUUID() fuelCardId?: string | null;
  @IsOptional() @IsString() @MaxLength(150) fuelStation?: string;
  @IsOptional() @IsString() receiptPhotoKey?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
