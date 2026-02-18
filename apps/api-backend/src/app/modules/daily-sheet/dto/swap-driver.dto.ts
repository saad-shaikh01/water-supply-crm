import { IsUUID, IsOptional } from 'class-validator';

export class SwapDriverDto {
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @IsOptional()
  @IsUUID()
  vanId?: string;
}
