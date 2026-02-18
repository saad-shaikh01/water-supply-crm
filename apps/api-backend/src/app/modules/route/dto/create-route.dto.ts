import { IsString, IsOptional, IsUUID } from 'class-validator';

export class CreateRouteDto {
  @IsString()
  name!: string;

  @IsOptional()
  @IsUUID()
  defaultVanId?: string;
}
