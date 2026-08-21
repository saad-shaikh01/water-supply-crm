import {
  Controller,
  Get,
  Post,
  Param,
  BadRequestException,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { Throttle } from '@nestjs/throttler';
import { FleetDashboardService } from './fleet-dashboard.service';
import { StorageService } from '../../common/storage/storage.service';
import { RequirePermissions, RequireAnyPermission } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

const ALLOWED_PHOTO_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

@Controller('fleet')
export class FleetDashboardController {
  constructor(
    private readonly dashboardService: FleetDashboardService,
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
}
