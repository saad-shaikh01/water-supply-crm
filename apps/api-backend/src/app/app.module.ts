import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { DatabaseModule } from '@water-supply-crm/database';
import { SharedLoggingModule } from '@water-supply-crm/logging';
import { RateLimitingModule } from '@water-supply-crm/rate-limiting';
import { SharedCachingModule } from '@water-supply-crm/caching';
import { SharedQueueModule } from '@water-supply-crm/queue';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { VendorContextInterceptor } from './common/interceptors/vendor-context.interceptor';
import { VendorModule } from './modules/vendor/vendor.module';
import { UserModule } from './modules/user/user.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProductModule } from './modules/product/product.module';
import { RouteModule } from './modules/route/route.module';
import { CustomerModule } from './modules/customer/customer.module';
import { VanModule } from './modules/van/van.module';
import { DailySheetModule } from './modules/daily-sheet/daily-sheet.module';
import { TransactionModule } from './modules/transaction/transaction.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';

@Module({
  imports: [
    // Infrastructure
    DatabaseModule,
    SharedLoggingModule,
    RateLimitingModule,
    SharedCachingModule,
    SharedQueueModule,
    // Feature modules
    VendorModule,
    UserModule,
    AuthModule,
    ProductModule,
    RouteModule,
    CustomerModule,
    VanModule,
    DailySheetModule,
    TransactionModule,
    NotificationsModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: VendorContextInterceptor,
    },
  ],
})
export class AppModule {}
