import { IsOptional, IsString, IsEnum, Matches, IsIn } from 'class-validator';
import { VehicleOperationalStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export const VEHICLE_SORT_FIELDS = ['plateNumber', 'totalCost', 'fuelCost', 'kmDriven', 'costPerKm'] as const;

export class VehicleQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(VehicleOperationalStatus) operationalStatus?: VehicleOperationalStatus;
  // Vehicle-picker filter (§17.3) — GET /fleet/vehicles?active=true. Parsed
  // as a string, same convention as VanService.findAllPaginated's isActive.
  @IsOptional() @IsString() active?: string;
  // Fleet list page: "YYYY-MM" (Karachi). When present each row carries a
  // `period` cost/km breakdown and the response gets `meta.totals`. Omitted by
  // the vehicle-picker callers so they skip the extra aggregation.
  @IsOptional() @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'month must be YYYY-MM' }) month?: string;
  @IsOptional() @IsIn(VEHICLE_SORT_FIELDS as unknown as string[]) sortBy?: (typeof VEHICLE_SORT_FIELDS)[number];
  @IsOptional() @IsIn(['asc', 'desc']) sortDir?: 'asc' | 'desc';
}
