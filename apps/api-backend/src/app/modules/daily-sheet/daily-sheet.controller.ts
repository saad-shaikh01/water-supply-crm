import { Controller, Get, Post, Body, Param, Patch, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DailySheetService } from './daily-sheet.service';
import { GenerateSheetsDto } from './dto/generate-sheets.dto';
import { SubmitDeliveryDto } from './dto/submit-delivery.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('daily-sheets')
export class DailySheetController {
  constructor(private readonly dailySheetService: DailySheetService) {}

  @Post('generate')
  @Throttle({ short: { ttl: 1000, limit: 1 }, medium: { ttl: 60000, limit: 3 } })
  generate(@CurrentUser() user: any, @Body() dto: GenerateSheetsDto) {
    return this.dailySheetService.generate(user.vendorId, dto);
  }

  @Get('generation-status/:jobId')
  getGenerationStatus(@Param('jobId') jobId: string) {
    return this.dailySheetService.getGenerationStatus(jobId);
  }

  @Patch('items/:id')
  submitDelivery(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: SubmitDeliveryDto
  ) {
    return this.dailySheetService.submitDelivery(user.vendorId, id, dto);
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.dailySheetService.findAll(user.vendorId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.dailySheetService.findOne(user.vendorId, id);
  }
}
