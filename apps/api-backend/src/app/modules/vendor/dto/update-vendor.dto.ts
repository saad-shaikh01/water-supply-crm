import { IsString, IsOptional, IsBoolean } from 'class-validator';

export class UpdateVendorDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Vendor's Raast ID (phone number or CNIC) for manual payment reference */
  @IsOptional()
  @IsString()
  raastId?: string;
}
