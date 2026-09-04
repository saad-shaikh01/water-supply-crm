import { IsEnum, IsInt, Min, IsDateString, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';
import { VehicleServiceType } from '@prisma/client';

export class UpdateServiceRecordDto {
  @IsOptional() @IsEnum(VehicleServiceType) serviceType?: VehicleServiceType;
  @IsOptional() @IsInt() @Min(0) performedAtOdometer?: number;
  @IsOptional() @IsDateString() performedAtDate?: string;
  @IsOptional() @IsNumber() @Min(0) cost?: number;
  @IsOptional() @IsString() @MaxLength(150) workshopName?: string;
  @IsOptional() @IsString() invoicePhotoKey?: string;
  @IsOptional() @IsString() @MaxLength(500) partsReplaced?: string;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
