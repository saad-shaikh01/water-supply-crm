import { IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class MarkDamagedDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsEnum(['empty', 'filled'])
  fromStock!: 'empty' | 'filled';

  @IsOptional()
  @IsString()
  notes?: string;
}
