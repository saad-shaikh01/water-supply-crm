import { IsNumber, IsString, IsOptional, Min, Max } from 'class-validator';

export class UpdateLocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  /** Driver's current speed in km/h */
  @IsOptional()
  @IsNumber()
  @Min(0)
  speed?: number;

  /** Bearing / heading in degrees (0–360) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  bearing?: number;

  /** Driver status: ONLINE | DELIVERING | AWAY */
  @IsOptional()
  @IsString()
  status?: string;
}
