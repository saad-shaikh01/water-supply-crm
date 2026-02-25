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
import { CustomerPortalModule } from './modules/customer-portal/customer-portal.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { TrackingModule } from './modules/tracking/tracking.module';
import { HealthModule } from './modules/health/health.module';
import { EmailModule } from './modules/email/email.module';
import { BalanceReminderModule } from './modules/balance-reminder/balance-reminder.module';
import { PaymentModule } from './modules/payment/payment.module';
import { ExpenseModule } from './modules/expense/expense.module';
import { FcmModule } from './modules/fcm/fcm.module';
import { AuditModule } from './modules/audit/audit.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { OrderModule } from './modules/order/order.module';
import { TicketModule } from './modules/ticket/ticket.module';

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
    CustomerPortalModule,
    WhatsAppModule,
    TrackingModule,
    HealthModule,
    EmailModule,
    BalanceReminderModule,
    PaymentModule,
    FcmModule,
    ExpenseModule,
    AuditModule,
    AnalyticsModule,
    OrderModule,
    TicketModule,
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
