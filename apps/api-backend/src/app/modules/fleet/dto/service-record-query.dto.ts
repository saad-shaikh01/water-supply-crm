import { IsOptional, IsUUID, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ServiceRecordQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsString() @MaxLength(40) serviceType?: string;
}
