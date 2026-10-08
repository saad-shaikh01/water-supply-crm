import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import type { AuthUser } from '@water-supply-crm/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { RequireSuperAdmin } from '../../common/decorators/authz-markers.decorator';
import { UpsertVendorBrandingDto } from './dto/vendor-branding.dto';
import { BrandingImageKind, VendorBrandingService } from './vendor-branding.service';

const IMAGE_UPLOAD = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 1024 * 1024 }, // 1 MB
});

function imageKind(kind: string): BrandingImageKind {
  if (kind !== 'logo' && kind !== 'icon') throw new BadRequestException('kind must be "logo" or "icon"');
  return kind;
}

function previewDoc(doc?: string): 'statement' | 'receipt' {
  return doc === 'receipt' ? 'receipt' : 'statement';
}

function sendPdf(res: Response, buffer: Buffer, name: string) {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `inline; filename="${name}.pdf"`,
    'Content-Length': buffer.length,
    'Cache-Control': 'no-store',
  });
  res.end(buffer);
}

/** The signed-in vendor's own company profile (Settings -> Company Profile). */
@Controller('company-profile')
export class CompanyProfileController {
  constructor(private readonly branding: VendorBrandingService) {}

  @Get()
  @RequirePermissions('company_profile:view')
  get(@CurrentUser() user: AuthUser) {
    return this.branding.get(user.vendorId);
  }

  @Put()
  @RequirePermissions('company_profile:update')
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  save(@CurrentUser() user: AuthUser, @Body() dto: UpsertVendorBrandingDto) {
    return this.branding.upsert(user.vendorId, dto, user);
  }

  /** POST /company-profile/preview?doc=statement|receipt — renders the DRAFT form values as a sample PDF. */
  @Post('preview')
  @RequirePermissions('company_profile:view')
  @Throttle({ short: { ttl: 2000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  async preview(@CurrentUser() user: AuthUser, @Body() dto: UpsertVendorBrandingDto, @Query('doc') doc: string | undefined, @Res() res: Response) {
    sendPdf(res, await this.branding.preview(user.vendorId, dto, previewDoc(doc)), 'sample-document');
  }

  @Post('image/:kind')
  @RequirePermissions('company_profile:update')
  @Throttle({ short: { ttl: 2000, limit: 3 }, medium: { ttl: 60000, limit: 15 } })
  @UseInterceptors(IMAGE_UPLOAD)
  uploadImage(@CurrentUser() user: AuthUser, @Param('kind') kind: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    return this.branding.setImage(user.vendorId, imageKind(kind), file, user);
  }

  @Delete('image/:kind')
  @RequirePermissions('company_profile:update')
  removeImage(@CurrentUser() user: AuthUser, @Param('kind') kind: string) {
    return this.branding.removeImage(user.vendorId, imageKind(kind), user);
  }
}

/** Platform surface: super admin fills / fixes ANY vendor's company profile (docs §2, owner-confirmed 2026-10-08). */
@Controller('vendors/:vendorId/branding')
@RequireSuperAdmin()
export class VendorBrandingAdminController {
  constructor(private readonly branding: VendorBrandingService) {}

  @Get()
  get(@Param('vendorId') vendorId: string) {
    return this.branding.get(vendorId);
  }

  @Put()
  @Throttle({ short: { ttl: 1000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  save(@CurrentUser() user: AuthUser, @Param('vendorId') vendorId: string, @Body() dto: UpsertVendorBrandingDto) {
    return this.branding.upsert(vendorId, dto, user);
  }

  @Post('preview')
  @Throttle({ short: { ttl: 2000, limit: 3 }, medium: { ttl: 60000, limit: 20 } })
  async preview(@Param('vendorId') vendorId: string, @Body() dto: UpsertVendorBrandingDto, @Query('doc') doc: string | undefined, @Res() res: Response) {
    sendPdf(res, await this.branding.preview(vendorId, dto, previewDoc(doc)), 'sample-document');
  }

  @Post('image/:kind')
  @Throttle({ short: { ttl: 2000, limit: 3 }, medium: { ttl: 60000, limit: 15 } })
  @UseInterceptors(IMAGE_UPLOAD)
  uploadImage(@CurrentUser() user: AuthUser, @Param('vendorId') vendorId: string, @Param('kind') kind: string, @UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('No file provided');
    return this.branding.setImage(vendorId, imageKind(kind), file, user);
  }

  @Delete('image/:kind')
  removeImage(@CurrentUser() user: AuthUser, @Param('vendorId') vendorId: string, @Param('kind') kind: string) {
    return this.branding.removeImage(vendorId, imageKind(kind), user);
  }
}
