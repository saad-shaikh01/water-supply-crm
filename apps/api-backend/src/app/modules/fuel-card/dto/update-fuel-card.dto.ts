import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Edits a FuelCard's details, or flips isActive to deactivate/reactivate it. */
export class UpdateFuelCardDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  cardNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  issuer?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
