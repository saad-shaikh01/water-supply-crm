import { IsEnum, IsOptional, IsString } from 'class-validator';
import { IssueResolution } from '@prisma/client';

export class ResolveIssueDto {
  @IsEnum(IssueResolution)
  resolution: IssueResolution;

  @IsOptional()
  @IsString()
  notes?: string;
}
