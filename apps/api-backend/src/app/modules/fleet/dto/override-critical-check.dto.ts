import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class OverrideCriticalCheckDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note: string;
}
