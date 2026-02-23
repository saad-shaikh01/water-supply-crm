import { IsInt, Min } from 'class-validator';

export class CreateLoadDto {
  @IsInt()
  @Min(1)
  loadedFilled!: number;
}
