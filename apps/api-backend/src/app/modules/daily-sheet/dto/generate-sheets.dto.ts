import { IsDateString } from 'class-validator';

export class GenerateSheetsDto {
  @IsDateString()
  date!: string;
}
