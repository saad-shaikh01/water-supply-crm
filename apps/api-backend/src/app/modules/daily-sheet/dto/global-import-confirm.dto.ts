import { Type } from 'class-transformer';
import { IsArray, IsUUID, ValidateNested } from 'class-validator';
import { ImportRowDto } from './bulk-import-confirm.dto';

export class GlobalImportGroupDto {
  @IsUUID()
  sheetId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  rows!: ImportRowDto[];
}

export class GlobalImportConfirmDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GlobalImportGroupDto)
  groups!: GlobalImportGroupDto[];
}
