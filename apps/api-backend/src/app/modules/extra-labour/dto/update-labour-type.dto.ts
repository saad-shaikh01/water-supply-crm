import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateLabourTypeDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(50)
  name!: string;
}
