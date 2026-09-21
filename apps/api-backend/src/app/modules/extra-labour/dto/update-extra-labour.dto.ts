import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateExtraLabourDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string | null;

  @IsOptional()
  @IsString()
  labourTypeId?: string;

  @IsOptional()
  @IsString()
  notes?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
