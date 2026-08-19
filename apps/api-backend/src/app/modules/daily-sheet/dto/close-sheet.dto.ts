import { IsNumber, Min } from 'class-validator';

/** Trip feature: cash hand-in is no longer accumulated per-trip check-in —
 * it's a single actual figure the driver reports once, at the moment the
 * sheet is closed (or a close is requested, for Soft Close). Shared by both
 * the direct Staff/Admin close and the Driver/Salesman self-close request. */
export class CloseSheetDto {
  @IsNumber()
  @Min(0)
  actualCashHandedIn!: number;
}
