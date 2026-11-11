import { IsString, IsOptional, IsUUID, MinLength, MaxLength, Matches } from 'class-validator';
import { PASSWORD_COMPLEXITY, PASSWORD_COMPLEXITY_MESSAGE } from './create-vendor.dto';

export class ResetAdminPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(PASSWORD_COMPLEXITY, { message: PASSWORD_COMPLEXITY_MESSAGE })
  newPassword: string;

  /** Which VENDOR_ADMIN to reset; optional only when the vendor has exactly one active admin. */
  @IsOptional()
  @IsUUID()
  adminUserId?: string;

  /** The CALLING super admin's own password (re-authentication). */
  @IsString()
  @MinLength(1)
  superAdminPassword: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
