import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateServiceTypeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  label: string;

  // Optional starting interval applied to every vehicle's rule for this type.
  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) defaultIntervalKm?: number;
  @IsOptional() @IsInt() @Min(1) @Max(3650) defaultIntervalDays?: number;
}
