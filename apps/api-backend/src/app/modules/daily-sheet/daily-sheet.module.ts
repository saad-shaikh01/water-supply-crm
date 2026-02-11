import { Module } from '@nestjs/common';
import { DailySheetService } from './daily-sheet.service';
import { DailySheetController } from './daily-sheet.controller';

@Module({
  controllers: [DailySheetController],
  providers: [DailySheetService],
})
export class DailySheetModule {}
