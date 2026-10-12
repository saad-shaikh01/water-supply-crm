import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsOptional, IsUUID } from 'class-validator';

export class BulkAssignGroupDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1000)
  @IsUUID('4', { each: true })
  customerIds!: string[];

  /** Target group. Omit / null together with subGroupId to take the customers out of any group. */
  @IsOptional()
  @IsUUID()
  groupId?: string | null;

  @IsOptional()
  @IsUUID()
  subGroupId?: string | null;
}
