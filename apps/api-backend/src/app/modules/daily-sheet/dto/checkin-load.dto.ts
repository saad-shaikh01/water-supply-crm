import { IsBoolean, IsInt, IsOptional, Min } from 'class-validator';

export class CheckinLoadDto {
  @IsInt()
  @Min(0)
  returnedFilled!: number;

  @IsInt()
  @Min(0)
  collectedEmpty!: number;

  @IsInt()
  @Min(0)
  damagedOnVan!: number;

  @IsInt()
  @Min(0)
  leakedOnVan!: number;

  // Trip Edit-Unlock: re-submitting an already-checked-in trip. Only valid
  // when the caller is STAFF/VENDOR_ADMIN, or a DRIVER with an active
  // editUnlockExpiresAt window on this load (see DailySheetService.checkinLoad).
  @IsOptional()
  @IsBoolean()
  forceResubmit?: boolean;
}
