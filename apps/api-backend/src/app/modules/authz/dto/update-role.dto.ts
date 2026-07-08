import {
  IsString,
  IsOptional,
  IsArray,
  ArrayUnique,
  MinLength,
  MaxLength,
} from 'class-validator';
import { IsPermissionPattern } from '../../../common/validators/is-permission-pattern.validator';

export class UpdateRoleDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;

  /** When provided, fully replaces the role's permission set. */
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsPermissionPattern({ each: true })
  permissions?: string[];
}
