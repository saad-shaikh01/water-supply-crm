import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { AttendanceCategoryService } from './attendance-category.service';
import { CreateAttendanceCategoryDto } from './dto/create-attendance-category.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

/**
 * Per-vendor attendance-category catalogue behind the "Mark Attendance"
 * dialog's required category field (PRESENT only) — see the schema comment on
 * `StaffAttendance.categoryId`. Gated on `payroll:attendance_mark` throughout,
 * same as the mark endpoint itself: only markers ever touch this catalogue,
 * so no new RBAC key (mirrors `VehicleServiceTypeController` reusing
 * `fleet:*` for its own catalogue).
 */
@Controller('payroll/attendance-categories')
export class AttendanceCategoryController {
  constructor(private readonly categories: AttendanceCategoryService) {}

  @Get()
  @RequirePermissions('payroll:attendance_mark')
  list(@CurrentUser() user: AuthUser) {
    return this.categories.list(user.vendorId);
  }

  @Post()
  @RequirePermissions('payroll:attendance_mark')
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAttendanceCategoryDto) {
    return this.categories.create(user, dto);
  }

  @Delete(':id')
  @RequirePermissions('payroll:attendance_mark')
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.categories.remove(user, id);
  }
}
