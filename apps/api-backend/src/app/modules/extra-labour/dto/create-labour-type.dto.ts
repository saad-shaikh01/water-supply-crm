import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateLabourTypeDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  name!: string;
}
