import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
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
import { AuthzModule } from './modules/authz/authz.module';
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
import { DeliveryIssueModule } from './modules/delivery-issue/delivery-issue.module';
import { PaymentReminderModule } from './modules/payment-reminder/payment-reminder.module';
import { DamageCaseModule } from './modules/damage-case/damage-case.module';
import { WarehouseModule } from './modules/warehouse/warehouse.module';
import { CommunicationModule } from './modules/communication/communication.module';
import { CollectionPolicyModule } from './modules/collection-policy/collection-policy.module';
import { CustomerActivationModule } from './modules/customer-activation/customer-activation.module';

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
    AuthzModule,
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
    DeliveryIssueModule,
    PaymentReminderModule,
    DamageCaseModule,
    WarehouseModule,
    CommunicationModule,
    CollectionPolicyModule,
    CustomerActivationModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: VendorContextInterceptor,
    },
    // Global authorization chain (runs after the global ThrottlerGuard):
    //   1. JwtAuthGuard   — authenticates every request except @Public()
    //   2. PermissionsGuard — deny-by-default; enforces the route's authorization marker
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}
