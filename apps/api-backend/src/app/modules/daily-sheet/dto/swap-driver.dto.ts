import { IsUUID, IsOptional } from 'class-validator';

export class SwapDriverDto {
  @IsUUID()
  driverId!: string;

  @IsOptional()
  @IsUUID()
  vanId?: string;
}
