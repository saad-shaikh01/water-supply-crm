import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class UnlockEditDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(120)
  windowMinutes?: number;
}
