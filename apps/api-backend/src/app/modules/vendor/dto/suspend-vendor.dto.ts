import { IsOptional, IsString, MaxLength } from 'class-validator';

export class SuspendVendorDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
