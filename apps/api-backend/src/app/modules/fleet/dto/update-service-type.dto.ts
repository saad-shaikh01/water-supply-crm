import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

// The stable `key` (stored on rules/records) never changes. `defaultIntervalKm`/
// `defaultIntervalDays` only seed a vehicle's own VehicleMaintenanceRule the
// first time it sees this type (schema comment on VehicleServiceTypeDef) — a
// vehicle that already has a rule for this type is unaffected by this edit;
// fix its interval directly on that vehicle's Maintenance tab instead.
export class UpdateServiceTypeDto {
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  label: string;

  @IsOptional() @IsInt() @Min(1) @Max(1_000_000) defaultIntervalKm?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(3650) defaultIntervalDays?: number | null;
}
