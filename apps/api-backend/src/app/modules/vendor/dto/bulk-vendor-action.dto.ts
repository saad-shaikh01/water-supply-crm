import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class BulkVendorActionDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  vendorIds: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
