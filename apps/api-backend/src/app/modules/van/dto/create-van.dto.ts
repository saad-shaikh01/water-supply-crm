import { IsString, IsOptional, IsUUID } from 'class-validator';

export class CreateVanDto {
  @IsString()
  plateNumber!: string;

  @IsOptional()
  @IsUUID()
  defaultDriverId?: string;

  @IsOptional()
  @IsUUID()
  defaultSalesmanId?: string;
}
