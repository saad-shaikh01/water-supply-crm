import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { AttendanceStatus } from '@prisma/client';

/**
 * `GET /payroll/attendance/search` — a vendor-wide, cross-period attendance
 * filter (category / employee / status within a date range), independent of
 * the payroll-period grid. `dateFrom`/`dateTo` are required so the query is
 * always bounded — this is a reporting tool, not a full-history dump.
 */
export class AttendanceSearchQueryDto {
  @IsDateString()
  dateFrom: string;

  @IsDateString()
  dateTo: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  userId?: string;

  @IsOptional()
  @IsEnum(AttendanceStatus)
  status?: AttendanceStatus;
}
