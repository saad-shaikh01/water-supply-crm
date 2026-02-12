import { IsInt, Min } from 'class-validator';

export class LoadOutDto {
  @IsInt()
  @Min(0)
  filledOutCount!: number;
}
