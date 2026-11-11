import { IsString, IsEmail, IsOptional, IsNotEmpty, MaxLength, MinLength, Length, Matches } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const trimLower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

/** At least one letter and one digit (shared with the reset-password DTO). */
export const PASSWORD_COMPLEXITY = /^(?=.*[A-Za-z])(?=.*\d).+$/;
export const PASSWORD_COMPLEXITY_MESSAGE = 'password must contain at least one letter and one digit';

export class CreateVendorDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @IsString()
  @Length(2, 50)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, { message: 'slug must be lowercase letters, digits and single hyphens' })
  slug: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @Transform(trimLower)
  @IsEmail()
  adminEmail!: string;

  // bcrypt only uses the first 72 bytes
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(PASSWORD_COMPLEXITY, { message: PASSWORD_COMPLEXITY_MESSAGE })
  adminPassword!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  adminName!: string;
}
