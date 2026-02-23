import { IsInt, IsNumber, Min } from 'class-validator';

export class CheckinLoadDto {
  @IsInt()
  @Min(0)
  returnedFilled!: number;

  @IsInt()
  @Min(0)
  collectedEmpty!: number;

  @IsNumber()
  @Min(0)
  cashHandedIn!: number;
}
