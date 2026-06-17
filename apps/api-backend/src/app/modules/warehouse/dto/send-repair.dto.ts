import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class SendRepairDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsString()
  shopName!: string;

  @IsEnum(['damaged', 'empty'])
  fromStock!: 'damaged' | 'empty';

  @IsOptional()
  @IsString()
  notes?: string;
}
