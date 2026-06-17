import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class FillInDto {
  @IsUUID()
  productId!: string;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
