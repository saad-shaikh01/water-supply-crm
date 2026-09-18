import { IsInt, Min, IsDateString, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateServiceRecordDto {
  @IsOptional() @IsString() @MaxLength(40) serviceType?: string;
  @IsOptional() @IsInt() @Min(0) performedAtOdometer?: number;
  @IsOptional() @IsDateString() performedAtDate?: string;
  @IsOptional() @IsNumber() @Min(0) cost?: number;
  @IsOptional() @IsString() @MaxLength(150) workshopName?: string;
  @IsOptional() @IsString() invoicePhotoKey?: string;
  @IsOptional() @IsString() @MaxLength(500) partsReplaced?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
