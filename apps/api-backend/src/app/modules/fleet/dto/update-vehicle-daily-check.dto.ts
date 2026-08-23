import { IsInt, Min, IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * PATCH /fleet/daily-checks/:id — Odometer Correction (2026-08-23, owner
 * request). Staff/Admin only (fleet:update); a Driver's own mis-entry still
 * has to go through Staff/Admin, exactly like every other Fleet correction
 * path (fuel logs, service records). `reason` is mandatory — this silently
 * overwrites a value the driver signed off on with an odometer photo, so a
 * one-line "why" is the minimum accountability bar (mirrors
 * OverrideCriticalCheckDto's own note requirement).
 */
export class UpdateVehicleDailyCheckDto {
  @IsInt()
  @Min(0)
  odometerReading: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
