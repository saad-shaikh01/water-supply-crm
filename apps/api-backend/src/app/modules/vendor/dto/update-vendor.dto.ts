import { IsString, IsOptional, MaxLength } from 'class-validator';

/**
 * `slug` and `isActive` are intentionally absent: the slug is immutable, and suspension must go
 * through suspend/unsuspend (which set the Redis flag and write an audit row).
 */
export class UpdateVendorDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  logoUrl?: string;

  /** Vendor's Raast ID (phone number or CNIC) for manual payment reference */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  raastId?: string;
}
