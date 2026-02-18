import { IsString, IsOptional, IsUUID } from 'class-validator';

export class UpdateRouteDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsUUID()
  defaultVanId?: string;
}
