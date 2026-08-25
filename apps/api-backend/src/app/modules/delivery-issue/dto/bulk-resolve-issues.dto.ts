import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { IssueResolution } from '@prisma/client';

/** Delivery Issues Phase 4 — loops the existing single resolve() per id server-side. */
export class BulkResolveIssuesDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  ids!: string[];

  @IsEnum(IssueResolution)
  resolution!: IssueResolution;

  @IsOptional()
  @IsString()
  notes?: string;
}
