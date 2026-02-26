import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { IssueNextAction } from '@prisma/client';

export class PlanIssueDto {
  @IsEnum(IssueNextAction)
  nextAction: IssueNextAction;

  @IsOptional()
  @IsDateString()
  retryAt?: string;

  @IsOptional()
  @IsUUID()
  assignedToUserId?: string;

  @IsOptional()
  @IsUUID()
  assignedVanId?: string;

  @IsOptional()
  @IsUUID()
  assignedDriverId?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
