import { IsOptional, IsString, IsEnum } from 'class-validator';
import { VehicleOperationalStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class VehicleQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(VehicleOperationalStatus) operationalStatus?: VehicleOperationalStatus;
  // Vehicle-picker filter (§17.3) — GET /fleet/vehicles?active=true. Parsed
  // as a string, same convention as VanService.findAllPaginated's isActive.
  @IsOptional() @IsString() active?: string;
}
