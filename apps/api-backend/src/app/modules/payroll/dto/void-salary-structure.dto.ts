import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Void (owner-requested 2026-09-25) — only the current/latest row is eligible. */
export class VoidSalaryStructureDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  voidReason: string;
}
