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

  // Reads `obj` (the raw query value) rather than `value` — the global ValidationPipe's
  // `enableImplicitConversion` coerces any non-empty string to `true` via `Boolean(value)`
  // before a `@Transform` sees it, which made 'false' and 'true' indistinguishable here and
  // silently dropped the filter (both landed on the `undefined` fallback).
  @IsOptional()
  @Transform(({ obj }) => obj.isActive === 'true' ? true : obj.isActive === 'false' ? false : undefined)
  isActive?: boolean;
}
