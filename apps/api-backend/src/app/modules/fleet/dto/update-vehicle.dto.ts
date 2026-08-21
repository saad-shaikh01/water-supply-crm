import { IsString, IsOptional, IsUUID, MaxLength } from 'class-validator';

/** PATCH /fleet/vehicles/:id/basic — updates the base Vehicle entity fields (not the VehicleProfile enrichment). */
export class UpdateVehicleDto {
  @IsOptional()
  @IsString()
  @MaxLength(50)
  plateNumber?: string;

  // Pass null to clear the usual-route default.
  @IsOptional()
  @IsUUID()
  usualVanId?: string | null;
}
