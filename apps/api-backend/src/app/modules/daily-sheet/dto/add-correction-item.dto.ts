import { IsString, MinLength } from 'class-validator';
import { AddAdhocItemDto } from './add-adhoc-item.dto';

export class AddCorrectionItemDto extends AddAdhocItemDto {
  @IsString()
  @MinLength(3)
  correctionNote!: string;
}
