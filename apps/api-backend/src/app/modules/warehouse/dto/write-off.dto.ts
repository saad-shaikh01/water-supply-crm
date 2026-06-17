import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class WriteOffDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsEnum(['damaged', 'leaked'])
  fromStock!: 'damaged' | 'leaked';

  @IsOptional()
  @IsString()
  notes?: string;
}
