import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { WhatsAppAccountStatus } from '@prisma/client';

/** No page => legacy array response (the vendor-dashboard account picker still consumes it). */
export class PlatformWhatsAppListQueryDto {
  @IsOptional() @IsEnum(WhatsAppAccountStatus) status?: WhatsAppAccountStatus;
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}

export class AssignableVendorsQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

export class AssignVendorDto {
  @IsUUID() vendorId!: string;
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  replace?: boolean;
}

export class UnassignVendorDto {
  @IsUUID() vendorId!: string;
}
