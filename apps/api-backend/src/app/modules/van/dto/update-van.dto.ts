import { IsString, IsOptional, IsUUID } from 'class-validator';

export class UpdateVanDto {
  @IsOptional()
  @IsString()
  plateNumber?: string;

  @IsOptional()
  @IsUUID()
  defaultDriverId?: string;
}
