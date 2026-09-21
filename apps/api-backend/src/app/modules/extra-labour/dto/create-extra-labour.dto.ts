import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateExtraLabourDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @IsNotEmpty()
  @IsString()
  labourTypeId!: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
