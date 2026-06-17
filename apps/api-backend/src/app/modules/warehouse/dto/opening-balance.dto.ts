import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class OpeningBalanceDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(0)
  filledCount!: number;

  @IsInt()
  @Min(0)
  emptyCount!: number;

  @IsInt()
  @Min(0)
  damagedCount!: number;

  @IsInt()
  @Min(0)
  leakedCount!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
