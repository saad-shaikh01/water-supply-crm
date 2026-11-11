import { AnnouncementAudience, AnnouncementSeverity, AnnouncementStatus } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class CreateAnnouncementDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body!: string;

  @IsOptional()
  @IsEnum(AnnouncementSeverity)
  severity?: AnnouncementSeverity;

  @IsOptional()
  @IsEnum(AnnouncementAudience)
  audience?: AnnouncementAudience;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  vendorIds?: string[];

  @IsOptional()
  @IsDateString()
  scheduledFor?: string;
}

export class UpdateAnnouncementDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body?: string;

  @IsOptional()
  @IsEnum(AnnouncementSeverity)
  severity?: AnnouncementSeverity;

  @IsOptional()
  @IsEnum(AnnouncementAudience)
  audience?: AnnouncementAudience;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  vendorIds?: string[];

  /** ISO date to (re)schedule; `null` reverts to DRAFT. */
  @IsOptional()
  @IsDateString()
  scheduledFor?: string | null;
}

export class ListAnnouncementsQueryDto extends PaginationQueryDto {
  @IsOptional()
  @IsEnum(AnnouncementStatus)
  status?: AnnouncementStatus;
}
