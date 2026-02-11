import { IsUUID, IsNumber, Min } from 'class-validator';

export class SetCustomPriceDto {
  @IsUUID()
  productId!: string;

  @IsNumber()
  @Min(0)
  price!: number;
}
