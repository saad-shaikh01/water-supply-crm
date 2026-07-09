import { IsDateString, IsOptional, IsArray, IsUUID } from 'class-validator';

export class ExportPreviewQueryDto {
  @IsDateString()
  date!: string;

  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  vanIds?: string[];
}
