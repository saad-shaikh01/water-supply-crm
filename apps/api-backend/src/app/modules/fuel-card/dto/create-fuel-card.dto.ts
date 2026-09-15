import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Registers a new FuelCard for the vendor. A vendor may register any number of cards. */
export class CreateFuelCardDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  cardNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  issuer?: string;
}
