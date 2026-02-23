import { IsArray, IsDateString, IsOptional, IsUUID } from 'class-validator';

export class GenerateSheetsDto {
  @IsDateString()
  date!: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  vanIds?: string[];
}
