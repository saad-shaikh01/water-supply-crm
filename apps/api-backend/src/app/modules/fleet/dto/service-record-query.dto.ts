import { IsOptional, IsUUID, IsString, MaxLength, IsDateString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ServiceRecordQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() vehicleId?: string;
  @IsOptional() @IsString() @MaxLength(40) serviceType?: string;
  @IsOptional() @IsDateString() dateFrom?: string;
  @IsOptional() @IsDateString() dateTo?: string;
}
