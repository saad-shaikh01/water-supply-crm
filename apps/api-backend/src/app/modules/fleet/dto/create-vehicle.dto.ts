import { IsString, IsOptional, IsUUID, MaxLength } from 'class-validator';

/**
 * POST /fleet/vehicles — creates a new physical vehicle (plate). Separate
 * from VehicleProfile (make/model/etc.), which is an optional 1:1
 * enrichment lazily upserted afterward (see VehicleProfileService).
 */
export class CreateVehicleDto {
  @IsString()
  @MaxLength(50)
  plateNumber!: string;

  // The route this vehicle usually (not exclusively) serves — a default for
  // the Vehicle Check start-picker, not a constraint (§17.5, locked).
  @IsOptional()
  @IsUUID()
  usualVanId?: string;
}
