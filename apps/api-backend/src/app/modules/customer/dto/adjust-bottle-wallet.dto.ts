import { IsEnum, IsInt, IsNotEmpty, IsString, IsUUID, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

/**
 * DELTA (default): add/subtract `delta` bottles from the current balance.
 * SET (advanced): overwrite the balance with `newBalance` exactly.
 */
export enum BottleWalletAdjustmentMode {
  DELTA = 'DELTA',
  SET = 'SET',
}

export class AdjustBottleWalletDto {
  @IsUUID('4')
  productId!: string;

  @IsEnum(BottleWalletAdjustmentMode)
  mode!: BottleWalletAdjustmentMode;

  /** Signed change in bottles, e.g. +2 or -2. Required (and only used) when mode = DELTA. */
  @ValidateIf((o) => o.mode === BottleWalletAdjustmentMode.DELTA)
  @IsInt()
  delta?: number;

  /** Exact balance to set. Required (and only used) when mode = SET. */
  @ValidateIf((o) => o.mode === BottleWalletAdjustmentMode.SET)
  @IsInt()
  @Min(0)
  newBalance?: number;

  /** Mandatory audit trail — why the wallet is being corrected. */
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
