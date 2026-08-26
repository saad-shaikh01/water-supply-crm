import { IsDateString, IsOptional, IsArray, IsUUID, IsIn } from 'class-validator';
import { Transform } from 'class-transformer';

export class ExportCsvQueryDto {
  @IsDateString()
  date!: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value))
  @IsArray()
  @IsUUID('4', { each: true })
  vanIds?: string[];

  // Which rows to include — deliveries (DailySheetItem), standalone payments
  // (Transaction, office/walk-in), or both (default, unchanged behavior).
  @IsOptional()
  @IsIn(['both', 'deliveries', 'payments'])
  exportType?: 'both' | 'deliveries' | 'payments';
}
