import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE_NAMES } from '@water-supply-crm/queue';
import { DailySheetService } from './daily-sheet.service';
import { DailySheetController } from './daily-sheet.controller';
import { DailySheetProcessor } from './daily-sheet.processor';
import { DailySheetPdfService } from './pdf/daily-sheet-pdf.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE_NAMES.DAILY_SHEET_GENERATION }),
  ],
  controllers: [DailySheetController],
  providers: [DailySheetService, DailySheetProcessor, DailySheetPdfService],
})
export class DailySheetModule {}
