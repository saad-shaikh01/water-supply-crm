import { IsOptional, IsString, IsUUID, IsIn } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class CustomerQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsUUID()
  routeId?: string;

  @IsOptional()
  @IsIn(['name', 'customerCode', 'createdAt'])
  sort?: string = 'name';
}
