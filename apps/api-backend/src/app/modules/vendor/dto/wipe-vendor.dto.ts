import { Equals, IsBoolean, IsString, MinLength } from 'class-validator';

export class WipeVendorDto {
  /** Must equal the vendor's slug — typed by the super admin, never pre-filled. */
  @IsString()
  @MinLength(1)
  confirmSlug!: string;

  /** The super admin's own password (re-authentication for a destructive action). */
  @IsString()
  @MinLength(1)
  password!: string;

  /** "I have taken a fresh database backup." */
  @IsBoolean()
  @Equals(true, { message: 'You must confirm that a fresh database backup has been taken.' })
  acknowledgeBackup!: boolean;

  /** From the preview the super admin just looked at; a different row count means the data changed since. */
  @IsString()
  @MinLength(1)
  previewToken!: string;
}
