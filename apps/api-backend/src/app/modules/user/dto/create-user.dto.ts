import { IsString, IsEmail, IsEnum, IsOptional, MinLength, ValidateIf } from 'class-validator';
import { UserRole } from '@prisma/client';

/** Roles that represent field staff without dashboard/portal access. */
export const NO_LOGIN_ROLES: UserRole[] = [UserRole.SALESMAN, UserRole.LOADER];

export class CreateUserDto {
  // Email + password are required for login-capable roles, optional for
  // no-login field staff (SALESMAN / LOADER).
  @ValidateIf((o) => !NO_LOGIN_ROLES.includes(o.role) || o.email !== undefined)
  @IsEmail()
  email?: string;

  @ValidateIf((o) => !NO_LOGIN_ROLES.includes(o.role) || o.password !== undefined)
  @IsString()
  @MinLength(8)
  password?: string;

  @IsString()
  name!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  @IsOptional()
  @IsString()
  phoneNumber?: string;
}
