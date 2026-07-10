import { IsDateString, IsOptional, IsArray, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';

export class ExportCsvQueryDto {
  @IsDateString()
  date!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray()
  @IsUUID('4', { each: true })
  vanIds?: string[];
}
