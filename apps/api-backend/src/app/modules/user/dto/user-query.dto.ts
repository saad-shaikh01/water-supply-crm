import { IsEnum, IsOptional } from 'class-validator';
import { Transform } from 'class-transformer';
import { UserRole } from '@prisma/client';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class UserQueryDto extends PaginationQueryDto {
  // Accepts a single role ("DRIVER") or a comma-separated list ("DRIVER,SALESMAN") —
  // the latter lets pickers like driver-filter.tsx fetch every field-driver-eligible
  // role (see crew-validation.ts's FIELD_STAFF_ROLES) in one request.
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',') : value))
  @IsEnum(UserRole, { each: true })
  role?: UserRole[];

  @IsOptional()
  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : undefined)
  isActive?: boolean;
}
