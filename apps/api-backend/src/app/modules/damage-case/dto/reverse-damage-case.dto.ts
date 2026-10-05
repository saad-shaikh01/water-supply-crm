import { IsInt, Min } from 'class-validator';

export class ReverseDamageCaseDto {
  @IsInt()
  @Min(0)
  version: number;
}
