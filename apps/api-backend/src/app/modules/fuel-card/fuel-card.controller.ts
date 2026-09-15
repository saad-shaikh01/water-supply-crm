import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { extname } from 'path';
import { Throttle } from '@nestjs/throttler';
import { FuelCardService } from './fuel-card.service';
import { CreateFuelCardDto } from './dto/create-fuel-card.dto';
import { UpdateFuelCardDto } from './dto/update-fuel-card.dto';
import { CreateFuelCardTopUpDto } from './dto/create-fuel-card-topup.dto';
import { VoidFuelCardTopUpDto } from './dto/void-fuel-card-topup.dto';
import { FuelCardTopUpQueryDto } from './dto/fuel-card-topup-query.dto';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { StorageService } from '../../common/storage/storage.service';
import type { AuthUser } from '@water-supply-crm/types';

const ALLOWED_ATTACHMENT_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];

/**
 * Fuel Card Wallet (owner-requested 2026-09-15).
 *   - GET /fuel-cards, GET /fuel-cards/top-ups, GET .../attachment → fuel_cards:view.
 *   - POST /fuel-cards, PATCH /fuel-cards/:id → fuel_cards:manage.
 *   - POST /fuel-cards/:id/top-ups, POST top-ups/attachment → fuel_cards:topup.
 *   - PATCH /fuel-cards/top-ups/:id/void → fuel_cards:topup_void.
 * Static `/fuel-cards/top-ups*` routes are declared before the dynamic
 * `/fuel-cards/:id` route (NestJS route-shadowing convention used throughout
 * this codebase).
 */
@Controller('fuel-cards')
export class FuelCardController {
  constructor(
    private readonly fuelCards: FuelCardService,
    private readonly storage: StorageService,
  ) {}

  // ── Static routes BEFORE parameterised /:id routes ─────────────────────

  @Get()
  @RequirePermissions('fuel_cards:view')
  listCards(@CurrentUser() user: AuthUser) {
    return this.fuelCards.listCards(user.vendorId);
  }

  @Post()
  @RequirePermissions('fuel_cards:manage')
  createCard(@CurrentUser() user: AuthUser, @Body() dto: CreateFuelCardDto) {
    return this.fuelCards.createCard(user, dto);
  }

  /**
   * POST /fuel-cards/top-ups/attachment
   * Upload a single receipt image or PDF to Wasabi. Returns { key } — pass it
   * as CreateFuelCardTopUpDto.attachmentKey.
   */
  @Post('top-ups/attachment')
  @RequirePermissions('fuel_cards:topup')
  @Throttle({ short: { ttl: 2000, limit: 5 }, medium: { ttl: 60000, limit: 30 } })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
      fileFilter: (_req, file, cb) => {
        if (ALLOWED_ATTACHMENT_EXTS.includes(extname(file.originalname).toLowerCase())) {
          cb(null, true);
        } else {
          cb(new Error('Only JPG, PNG, WEBP, or PDF files are allowed'), false);
        }
      },
    }),
  )
  async uploadTopUpAttachment(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    const { key } = await this.storage.upload('fuel-card-topup', file.buffer, file.originalname, file.mimetype);
    return { key };
  }

  @Get('top-ups')
  @RequirePermissions('fuel_cards:view')
  listTopUps(@CurrentUser() user: AuthUser, @Query() query: FuelCardTopUpQueryDto) {
    return this.fuelCards.listTopUps(user.vendorId, query);
  }

  @Get('top-ups/:id/attachment')
  @RequirePermissions('fuel_cards:view')
  async getTopUpAttachment(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const key = await this.fuelCards.getTopUpAttachmentKey(user.vendorId, id);
    return { signedUrl: await this.storage.getSignedUrl(key) };
  }

  @Patch('top-ups/:id/void')
  @RequirePermissions('fuel_cards:topup_void')
  voidTopUp(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: VoidFuelCardTopUpDto) {
    return this.fuelCards.voidTopUp(user, id, dto);
  }

  // ── Per-card routes ──────────────────────────────────────────────────────

  @Post(':id/top-ups')
  @RequirePermissions('fuel_cards:topup')
  createTopUp(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: CreateFuelCardTopUpDto) {
    return this.fuelCards.createTopUp(user, id, dto);
  }

  @Patch(':id')
  @RequirePermissions('fuel_cards:manage')
  updateCard(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: UpdateFuelCardDto) {
    return this.fuelCards.updateCard(user, id, dto);
  }
}
