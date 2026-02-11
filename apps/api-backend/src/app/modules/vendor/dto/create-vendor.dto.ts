import { IsString, IsEmail, IsOptional } from 'class-validator';

export class CreateVendorDto {
  @IsString()
  name: string;

  @IsString()
  slug: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsEmail()
  adminEmail!: string;

  @IsString()
  adminPassword!: string;

  @IsString()
  adminName!: string;
}
