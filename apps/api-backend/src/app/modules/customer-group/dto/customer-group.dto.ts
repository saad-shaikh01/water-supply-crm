import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateCustomerGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  /** Omit for a top-level Group; set to a Group id to create a SubGroup under it. */
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateCustomerGroupDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;
}

export class UpdateGroupingSettingsDto {
  @IsBoolean()
  enabled!: boolean;
}
