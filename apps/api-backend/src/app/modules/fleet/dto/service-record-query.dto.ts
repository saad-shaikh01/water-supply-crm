import { IsOptional, IsUUID, IsEnum } from 'class-validator';
import { VehicleServiceType } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ServiceRecordQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsEnum(VehicleServiceType) serviceType?: VehicleServiceType;
}
