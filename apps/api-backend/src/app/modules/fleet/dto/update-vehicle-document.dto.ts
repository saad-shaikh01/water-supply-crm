import { IsOptional, IsString, IsInt, Min, Max, IsEnum, IsDateString, MaxLength } from 'class-validator';
import { VehicleDocumentType } from '@prisma/client';

export class UpdateVehicleDocumentDto {
  @IsOptional() @IsEnum(VehicleDocumentType) type?: VehicleDocumentType;
  @IsOptional() @IsString() @MaxLength(100) documentNumber?: string;
  @IsOptional() @IsString() @MaxLength(150) issuingAuthority?: string;
  @IsOptional() @IsDateString() issueDate?: string;
  @IsOptional() @IsDateString() expiryDate?: string;
  @IsOptional() @IsString() fileKey?: string;
  @IsOptional() @IsInt() @Min(1) @Max(365) reminderDaysBefore?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
