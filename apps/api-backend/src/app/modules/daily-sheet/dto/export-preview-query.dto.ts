import { IsDateString, IsOptional, IsArray, IsUUID, IsIn } from 'class-validator';

export class ExportPreviewQueryDto {
  @IsDateString()
  date!: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  vanIds?: string[];

  // Same meaning as ExportCsvQueryDto.exportType — keeps the preview in
  // sync with what the actual CSV download will contain.
  @IsOptional()
  @IsIn(['both', 'deliveries', 'payments'])
  exportType?: 'both' | 'deliveries' | 'payments';
}
