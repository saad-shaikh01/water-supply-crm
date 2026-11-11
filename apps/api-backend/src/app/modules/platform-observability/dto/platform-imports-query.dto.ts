import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { ImportBatchStatus, ImportEntity } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class PlatformImportsQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsEnum(ImportBatchStatus) status?: ImportBatchStatus;
  @IsOptional() @IsEnum(ImportEntity) entity?: ImportEntity;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
