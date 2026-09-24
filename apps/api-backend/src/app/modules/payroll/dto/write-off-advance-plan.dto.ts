import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Write-off / forgive (owner-requested 2026-09-25) — only an ACTIVE plan with remaining balance > 0 is eligible. */
export class WriteOffAdvancePlanDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
