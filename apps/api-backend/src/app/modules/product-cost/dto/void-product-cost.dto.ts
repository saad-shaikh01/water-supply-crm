import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Void (design doc §4.3) — only the current/latest row is eligible. */
export class VoidProductCostDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  voidReason: string;
}
