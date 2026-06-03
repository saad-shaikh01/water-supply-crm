import { IsInt, Min } from 'class-validator';

export class UpdateDamageCaseDto {
  @IsInt()
  @Min(1)
  bottleCount: number;

  @IsInt()
  @Min(0)
  version: number;
}
