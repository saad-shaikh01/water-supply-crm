import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import type { AuthUser } from '@water-supply-crm/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { IMPORT_LIMITS } from './import.constants';
import { ColumnValuesQueryDto, ExecuteImportDto, ImportListQueryDto, ImportRowsQueryDto, SaveMappingDto, UploadImportDto } from './dto/import.dto';
import { ImportErrorFilter } from './import-error.filter';
import { ImportService } from './import.service';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Controller('imports')
@UseFilters(ImportErrorFilter)
export class ImportController {
  constructor(private readonly imports: ImportService) {}

  // ── static routes first (declared before /:id) ───────────────────────────

  @Get('entities')
  @RequirePermissions('data_imports:view')
  entities() {
    return this.imports.entities();
  }

  @Get('templates/:entity')
  @RequirePermissions('data_imports:view')
  async template(@Param('entity') entity: string, @Res() res: Response) {
    const buffer = await this.imports.buildTemplate(entity);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${entity.toLowerCase().replace(/_/g, '-')}-template.xlsx"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Get('mapping-profiles')
  @RequirePermissions('data_imports:view')
  profiles(@CurrentUser() user: AuthUser, @Query('entity') entity?: string) {
    return this.imports.profiles(user.vendorId, entity);
  }

  @Delete('mapping-profiles/:id')
  @RequirePermissions('data_imports:upload')
  deleteProfile(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.deleteProfile(user.vendorId, id);
  }

  @Get()
  @RequirePermissions('data_imports:view')
  list(@CurrentUser() user: AuthUser, @Query() query: ImportListQueryDto) {
    return this.imports.list(user.vendorId, query);
  }

  @Post(':entity')
  @RequirePermissions('data_imports:upload')
  @Throttle({ short: { ttl: 5000, limit: 2 }, medium: { ttl: 60000, limit: 10 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: IMPORT_LIMITS.maxFileBytes, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('entity') entity: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: UploadImportDto,
  ) {
    return this.imports.createBatch(user, entity, file, dto);
  }

  // ── per-batch ─────────────────────────────────────────────────────────────

  @Get(':id')
  @RequirePermissions('data_imports:view')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.get(user.vendorId, id);
  }

  @Put(':id/mapping')
  @RequirePermissions('data_imports:upload')
  @Throttle({ short: { ttl: 2000, limit: 2 }, medium: { ttl: 60000, limit: 20 } })
  saveMapping(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SaveMappingDto) {
    return this.imports.saveMapping(user, id, dto);
  }

  @Get(':id/column-values')
  @RequirePermissions('data_imports:view')
  columnValues(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: ColumnValuesQueryDto) {
    return this.imports.columnValues(user.vendorId, id, q.header);
  }

  @Get(':id/rows')
  @RequirePermissions('data_imports:view')
  rows(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: ImportRowsQueryDto) {
    return this.imports.rows(user.vendorId, id, q);
  }

  @Get(':id/report')
  @RequirePermissions('data_imports:view')
  async report(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { buffer, fileName } = await this.imports.report(user.vendorId, id);
    res.setHeader('Content-Type', XLSX_MIME);
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  }

  @Get(':id/source')
  @RequirePermissions('data_imports:view')
  source(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.sourceUrl(user.vendorId, id);
  }

  @Post(':id/execute')
  @RequirePermissions('data_imports:execute')
  @Throttle({ short: { ttl: 2000, limit: 1 }, medium: { ttl: 60000, limit: 5 } })
  execute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ExecuteImportDto) {
    return this.imports.execute(user, id, dto);
  }

  @Post(':id/cancel')
  @RequirePermissions('data_imports:upload')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.cancel(user, id);
  }

  @Post(':id/revert/preview')
  @RequirePermissions('data_imports:revert')
  revertPreview(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.revertPreview(user.vendorId, id);
  }

  @Post(':id/revert')
  @RequirePermissions('data_imports:revert')
  @Throttle({ short: { ttl: 2000, limit: 1 }, medium: { ttl: 60000, limit: 5 } })
  revert(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.imports.revert(user, id);
  }
}
