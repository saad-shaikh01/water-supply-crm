import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/** Multipart text fields that accompany the uploaded file. */
export class UploadImportDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  sheetName?: string;

  /** 1-based row holding the column names; auto-detected when omitted. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  headerRow?: number;

  /** A draft batch the user is re-uploading over (e.g. to change the header row). */
  @IsOptional()
  @IsUUID()
  replaceBatchId?: string;
}

export class SaveMappingDto {
  /** header → field key (null / omitted = ignore column). */
  @IsObject()
  columns!: Record<string, string | null>;

  /** field key → (file value → canonical value, or "__SKIP_ROW__"). */
  @IsOptional()
  @IsObject()
  valueMaps?: Record<string, Record<string, string>>;

  @IsOptional()
  @IsObject()
  options?: Record<string, unknown>;

  /** Save this mapping for next time under this name. */
  @IsOptional()
  @IsString()
  @MaxLength(80)
  saveProfileAs?: string;
}

export class ExecuteImportDto {
  @IsString()
  @MaxLength(128)
  planHash!: string;

  @IsBoolean()
  acknowledgeWarnings!: boolean;

  @IsOptional()
  @IsBoolean()
  acknowledgeDuplicateFile?: boolean;
}

export class ImportListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsString()
  entity?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

export class ImportRowsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsIn(['CREATE', 'UPDATE', 'SKIP_EXISTING', 'SKIP_INVALID'])
  action?: string;

  @IsOptional()
  @IsIn(['ERROR', 'WARNING'])
  severity?: string;

  @IsOptional()
  @IsIn(['PENDING', 'CREATED', 'UPDATED', 'SKIPPED', 'FAILED', 'REVERTED', 'REVERT_SKIPPED'])
  result?: string;

  /** Customer-code order (natural: A9 before A10). Default is file order. */
  @IsOptional()
  @IsIn(['row', 'code', 'code_desc'])
  sort?: 'row' | 'code' | 'code_desc';

  @IsOptional()
  @IsIn(['active', 'closed'])
  status?: 'active' | 'closed';

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class UpdateImportRowDto {
  /** field key → new cell text (null/'' clears the cell). */
  @IsObject()
  values!: Record<string, string | null>;
}

export class ReportQueryDto {
  /** Omit for the full report; otherwise only the rows that need fixing, laid out for re-upload. */
  @IsOptional()
  @IsIn(['errors', 'warnings', 'problems'])
  scope?: 'errors' | 'warnings' | 'problems';
}

export class ColumnValuesQueryDto {
  @IsString()
  @MaxLength(200)
  header!: string;
}
