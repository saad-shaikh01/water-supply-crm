import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

export class StartImpersonationDto {
  @IsUUID()
  vendorId!: string;

  @IsOptional()
  @IsUUID()
  targetUserId?: string;

  @IsString()
  @Length(10, 500)
  reason!: string;

  @IsEnum(['READ_ONLY', 'SUPPORT'])
  mode!: 'READ_ONLY' | 'SUPPORT';

  @IsOptional()
  @Type(() => Number)
  @IsIn([15, 30, 60])
  ttlMinutes?: 15 | 30 | 60;
}

export class ExchangeImpersonationDto {
  @IsString()
  @Length(16, 128)
  code!: string;
}

export class ListImpersonationQueryDto {
  @IsOptional() @IsUUID() vendorId?: string;
  @IsOptional() @IsUUID() actorId?: string;

  @IsOptional()
  @Transform(({ value }) => (value === 'true' || value === true ? true : value === 'false' || value === false ? false : undefined))
  active?: boolean;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
