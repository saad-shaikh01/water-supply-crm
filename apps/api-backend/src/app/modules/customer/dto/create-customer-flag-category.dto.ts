import { IsHexColor, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateCustomerFlagCategoryDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @IsHexColor()
  color: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  defaultMessage?: string;
}
