import { IsUUID, IsNumber, Min, IsOptional, IsString, MaxLength } from 'class-validator';

export class SetCustomPriceDto {
  @IsUUID()
  productId!: string;

  @IsNumber()
  @Min(0)
  price!: number;

  /** Optional human reason, recorded on the audit entry. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
