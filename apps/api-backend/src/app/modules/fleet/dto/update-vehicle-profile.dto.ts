import { IsOptional, IsString, IsInt, Min, Max, IsNumber, IsEnum, IsDateString, MaxLength } from 'class-validator';
import { VehicleFuelType, VehicleOwnershipType, VehicleOperationalStatus } from '@prisma/client';

/**
 * PATCH /fleet/vehicles/:vehicleId. The service upserts — `version` is required
 * once a profile row already exists (optimistic concurrency, mirrors
 * DamageCase.version) and ignored on first creation.
 */
export class UpdateVehicleProfileDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  version?: number;

  @IsOptional() @IsString() @MaxLength(100) make?: string;
  @IsOptional() @IsString() @MaxLength(100) model?: string;
  @IsOptional() @IsInt() @Min(1950) @Max(2100) year?: number;
  @IsOptional() @IsString() @MaxLength(50) color?: string;
  @IsOptional() @IsString() @MaxLength(100) chassisNumber?: string;
  @IsOptional() @IsString() @MaxLength(100) engineNumber?: string;
  @IsOptional() @IsEnum(VehicleFuelType) fuelType?: VehicleFuelType;
  @IsOptional() @IsString() @MaxLength(50) transmissionType?: string;
  @IsOptional() @IsNumber() @Min(0) loadCapacityKg?: number;
  @IsOptional() @IsInt() @Min(0) seatingCapacity?: number;
  @IsOptional() @IsEnum(VehicleOwnershipType) ownershipType?: VehicleOwnershipType;
  @IsOptional() @IsDateString() purchaseDate?: string;
  @IsOptional() @IsNumber() @Min(0) purchaseCost?: number;
  @IsOptional() @IsString() @MaxLength(150) supplierName?: string;
  @IsOptional() @IsEnum(VehicleOperationalStatus) operationalStatus?: VehicleOperationalStatus;
}
