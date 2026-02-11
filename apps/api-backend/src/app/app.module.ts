import { Module } from '@nestjs/common';
import { DatabaseModule } from '@water-supply-crm/database';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VendorModule } from './modules/vendor/vendor.module';
import { UserModule } from './modules/user/user.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProductModule } from './modules/product/product.module';
import { RouteModule } from './modules/route/route.module';
import { CustomerModule } from './modules/customer/customer.module';
import { VanModule } from './modules/van/van.module';
import { DailySheetModule } from './modules/daily-sheet/daily-sheet.module';
import { TransactionModule } from './modules/transaction/transaction.module';

@Module({
  imports: [
    DatabaseModule,
    VendorModule,
    UserModule,
    AuthModule,
    ProductModule,
    RouteModule,
    CustomerModule,
    VanModule,
    DailySheetModule,
    TransactionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
