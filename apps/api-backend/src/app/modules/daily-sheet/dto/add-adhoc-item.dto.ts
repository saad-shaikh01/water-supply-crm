import { IsInt, IsNumber, IsOptional, IsUUID, Min } from 'class-validator';

export class AddAdhocItemDto {
  @IsUUID()
  customerId!: string;

  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(0)
  filledDropped!: number;

  @IsInt()
  @Min(0)
  emptyReceived!: number;

  @IsNumber()
  @Min(0)
  cashCollected!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  priceOverride?: number;
}
