import {
  IsArray,
  IsEnum,
  IsOptional,
  IsDateString,
  ValidateNested,
  ArrayUnique,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PermissionEffect } from '@prisma/client';
import { IsPermissionPattern } from '../../../common/validators/is-permission-pattern.validator';

export class PermissionOverrideItemDto {
  @IsPermissionPattern()
  permission!: string;

  @IsEnum(PermissionEffect)
  effect!: PermissionEffect;

  /** ISO date; null/omitted = permanent. Must be in the future (checked in service). */
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
}

export class UpdateOverridesDto {
  /** Full replacement of the user's overrides. */
  @IsArray()
  @ArrayUnique((o: PermissionOverrideItemDto) => o.permission)
  @ValidateNested({ each: true })
  @Type(() => PermissionOverrideItemDto)
  overrides!: PermissionOverrideItemDto[];
}
