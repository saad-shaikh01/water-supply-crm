import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { Throttle } from '@nestjs/throttler';
import { FleetDashboardService } from './fleet-dashboard.service';
import { VehicleCostService } from './vehicle-cost.service';
import { VehiclePeriodQueryDto, VehicleMonthlyReportQueryDto, VehicleOtherExpensesQueryDto } from './dto/vehicle-period-query.dto';
import { dayRange } from './fleet-period.util';
import { StorageService } from '../../common/storage/storage.service';
import { RequirePermissions, RequireAnyPermission } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

const ALLOWED_PHOTO_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

@Controller('fleet')
export class FleetDashboardController {
  constructor(
    private readonly dashboardService: FleetDashboardService,
    private readonly costService: VehicleCostService,
    private readonly storage: StorageService,
  ) {}

  /**
   * POST /fleet/upload-photo
   * Shared upload for odometer / damage / fuel-receipt / document / invoice
   * photos — mirrors damage-cases' upload-photo pattern exactly. Any of the
   * Fleet capture permissions may call it; what the resulting key is attached
   * to (and therefore what it actually authorizes) is decided by whichever
   * create/update DTO it's submitted with.
   */
  @Post('upload-photo')
  @RequireAnyPermission('fleet:update', 'fleet:record_check', 'fleet:record_fuel', 'fleet:manage_maintenance')
  @Throttle({ short: { ttl: 2000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_PHOTO_EXTS.includes(extname(file.originalname).toLowerCase())) {
          cb(null, true);
        } else {
          cb(new Error('Only JPG, PNG, WEBP images are allowed for Fleet photos'), false);
        }
      },
    }),
  )
  async uploadPhoto(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    const { key } = await this.storage.upload('fleet-photos', file.buffer, file.originalname, file.mimetype);
    return { key };
  }

  @Get('overview')
  @RequirePermissions('fleet:view')
  getOverview(@CurrentUser() user: AuthUser) {
    return this.dashboardService.getOverview(user.vendorId);
  }

  @Get('vehicles/:vehicleId/cost-summary')
  @RequirePermissions('fleet:view')
  getVehicleCostSummary(@CurrentUser() user: AuthUser, @Param('vehicleId') vehicleId: string) {
    return this.dashboardService.getVehicleCostSummary(user.vendorId, vehicleId);
  }

  /** Cost/km/efficiency for a custom date range (whole history when no range is given). */
  @Get('vehicles/:vehicleId/period-summary')
  @RequirePermissions('fleet:view')
  getVehiclePeriodSummary(
    @CurrentUser() user: AuthUser,
    @Param('vehicleId') vehicleId: string,
    @Query() query: VehiclePeriodQueryDto,
  ) {
    const range = dayRange(query.dateFrom, query.dateTo) ?? { from: new Date(0), to: new Date('9999-01-01T00:00:00Z') };
    return this.costService.getPeriodSummary(user.vendorId, vehicleId, range);
  }

  /** One row per month (oldest first) — chart + month-wise table on the vehicle page. */
  @Get('vehicles/:vehicleId/monthly-report')
  @RequirePermissions('fleet:view')
  getVehicleMonthlyReport(
    @CurrentUser() user: AuthUser,
    @Param('vehicleId') vehicleId: string,
    @Query() query: VehicleMonthlyReportQueryDto,
  ) {
    return this.costService.getMonthlyReport(user.vendorId, vehicleId, query.months ?? 12, query.endMonth);
  }

  /** The attributed non-fuel/non-maintenance expenses behind a vehicle's Other Cost. */
  @Get('vehicles/:vehicleId/other-expenses')
  @RequirePermissions('fleet:view')
  listVehicleOtherExpenses(
    @CurrentUser() user: AuthUser,
    @Param('vehicleId') vehicleId: string,
    @Query() query: VehicleOtherExpensesQueryDto,
  ) {
    const range = dayRange(query.dateFrom, query.dateTo) ?? { from: new Date(0), to: new Date('9999-01-01T00:00:00Z') };
    return this.costService.listOtherExpenses(user.vendorId, vehicleId, range, query.page, query.limit);
  }
}
