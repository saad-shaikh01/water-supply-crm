import { IsEnum, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class UserQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @IsOptional()
  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : undefined)
  isActive?: boolean;
}
