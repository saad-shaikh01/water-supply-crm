import { ArrayNotEmpty, IsArray, IsUUID } from 'class-validator';

export class BulkDeactivateDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  customerIds!: string[];
}
