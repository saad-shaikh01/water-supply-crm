import { IsOptional, IsDateString, IsInt, Min, IsNumber, IsBoolean, IsString, MaxLength } from 'class-validator';

export class UpdateFuelLogDto {
  @IsOptional() @IsDateString() date?: string;
  @IsOptional() @IsInt() @Min(0) odometerAtFill?: number;
  @IsOptional() @IsNumber() @Min(0.1) litersFilled?: number;
  @IsOptional() @IsNumber() @Min(0) amountPaid?: number;
  @IsOptional() @IsBoolean() isFullTank?: boolean;
  @IsOptional() @IsString() @MaxLength(150) fuelStation?: string;
  @IsOptional() @IsString() receiptPhotoKey?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
