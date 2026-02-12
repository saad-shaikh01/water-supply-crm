import { IsInt, IsNumber, Min } from 'class-validator';

export class CheckInDto {
  @IsInt()
  @Min(0)
  filledInCount!: number;

  @IsInt()
  @Min(0)
  emptyInCount!: number;

  @IsNumber()
  @Min(0)
  cashCollected!: number;
}
