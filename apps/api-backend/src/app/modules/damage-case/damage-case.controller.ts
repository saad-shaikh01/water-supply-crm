import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { Throttle } from '@nestjs/throttler';
import { DamageCaseService } from './damage-case.service';
import { StorageService } from '../../common/storage/storage.service';
import { ReportDamageCaseDto } from './dto/report-damage-case.dto';
import { UpdateDamageCaseDto } from './dto/update-damage-case.dto';
import { ChargeDamageCaseDto } from './dto/charge-damage-case.dto';
import { WaiveDamageCaseDto } from './dto/waive-damage-case.dto';
import { DamageCaseQueryDto } from './dto/damage-case-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '@water-supply-crm/types';

const ALLOWED_PHOTO_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

@Controller('damage-cases')
export class DamageCaseController {
  constructor(
    private readonly damageCaseService: DamageCaseService,
    private readonly storage: StorageService,
  ) {}

  // ── Static routes BEFORE parameterised /:id routes ──────────────────────

  /**
   * POST /damage-cases/upload-photo
   * Upload a single damage photo to Wasabi.
   * Returns { key } — store the key in the ReportDamageCaseDto.photoKeys array.
   */
  @Post('upload-photo')
  @RequirePermissions('damage_cases:create')
  @Throttle({ short: { ttl: 2000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_PHOTO_EXTS.includes(extname(file.originalname).toLowerCase())) {
          cb(null, true);
        } else {
          cb(new Error('Only JPG, PNG, WEBP images are allowed for damage photos'), false);
        }
      },
    }),
  )
  async uploadPhoto(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    const { key } = await this.storage.upload(
      'damage-photos',
      file.buffer,
      file.originalname,
      file.mimetype,
    );
    return { key };
  }

  /**
   * GET /damage-cases/my-cases
   * Driver's own damage cases (paginated).
   */
  @Get('my-cases')
  @RequirePermissions('damage_cases:view')
  getMyCases(
    @CurrentUser() user: AuthUser,
    @Query() query: DamageCaseQueryDto,
  ) {
    return this.damageCaseService.getMyCases(user, query);
  }

  /**
   * POST /damage-cases
   * Report a new damage case.
   */
  @Post()
  @RequirePermissions('damage_cases:create')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  report(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReportDamageCaseDto,
  ) {
    return this.damageCaseService.report(user, dto);
  }

  /**
   * GET /damage-cases
   * List all damage cases for this vendor (STAFF/VENDOR_ADMIN only).
   */
  // findAll lists the FULL vendor queue (service does not scope by driver) → gated by
  // damage_cases:review (staff/admin management view); drivers use my-cases for their own.
  @Get()
  @RequirePermissions('damage_cases:review')
  findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: DamageCaseQueryDto,
  ) {
    return this.damageCaseService.findAll(user, query);
  }

  // ── Parameterised /:id routes ─────────────────────────────────────────────

  /**
   * GET /damage-cases/:id
   * Get a single damage case. DRIVERs only see their own cases.
   */
  @Get(':id')
  @RequirePermissions('damage_cases:view')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.damageCaseService.findOne(user, id);
  }

  /**
   * PATCH /damage-cases/:id
   * Update bottleCount (REPORTED status only, optimistic locking).
   */
  @Patch(':id')
  @RequirePermissions('damage_cases:update')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDamageCaseDto,
  ) {
    return this.damageCaseService.update(user, id, dto);
  }

  /**
   * PATCH /damage-cases/:id/review
   * Move REPORTED → UNDER_REVIEW.
   */
  @Patch(':id/review')
  @RequirePermissions('damage_cases:review')
  @Throttle({ short: { ttl: 1000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  review(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.damageCaseService.review(user, id);
  }

  /**
   * PATCH /damage-cases/:id/charge
   * Charge the customer for the damage (UNDER_REVIEW → CHARGED).
   */
  @Patch(':id/charge')
  @RequirePermissions('damage_cases:charge')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 15 } })
  charge(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChargeDamageCaseDto,
  ) {
    return this.damageCaseService.charge(user, id, dto);
  }

  /**
   * PATCH /damage-cases/:id/waive
   * Waive the charge (UNDER_REVIEW → WAIVED).
   */
  @Patch(':id/waive')
  @RequirePermissions('damage_cases:waive')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 15 } })
  waive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WaiveDamageCaseDto,
  ) {
    return this.damageCaseService.waive(user, id, dto);
  }

  /**
   * PATCH /damage-cases/:id/reverse
   * Reverse a charge (CHARGED → REVERSED). Credits money only — bottle wallet NOT restored.
   */
  @Patch(':id/reverse')
  @RequirePermissions('damage_cases:reverse')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 15 } })
  reverse(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDamageCaseDto,
  ) {
    return this.damageCaseService.reverse(user, id, { version: dto.version });
  }

  /**
   * GET /damage-cases/:id/audit-log
   * Retrieve the full audit log for a damage case.
   */
  // Full audit trail = staff/admin management view (drivers excluded) → damage_cases:review.
  @Get(':id/audit-log')
  @RequirePermissions('damage_cases:review')
  getAuditLog(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.damageCaseService.getAuditLog(user, id);
  }
}
