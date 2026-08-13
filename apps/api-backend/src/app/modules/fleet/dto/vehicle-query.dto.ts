import { IsOptional, IsString, IsEnum } from 'class-validator';
import { VehicleOperationalStatus } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class VehicleQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsEnum(VehicleOperationalStatus) operationalStatus?: VehicleOperationalStatus;
}
