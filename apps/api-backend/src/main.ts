import { Logger } from 'nestjs-pino';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { join } from 'path';
import compression from 'compression';
import helmet from 'helmet';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    // The WhatsApp webhook verifies Meta's HMAC over the exact raw bytes (req.rawBody).
    rawBody: true,
  });
  app.useLogger(app.get(Logger));
  // Behind nginx (VPS deploy) — without this, req.ip resolves to the proxy's
  // address for every request, so the global ThrottlerGuard's per-IP bucket
  // (short: 10 req/s) ends up shared across ALL users instead of per-client.
  app.set('trust proxy', 1);
  app.use(compression());
  // JSON API: CSP is pointless here (and would break /uploads previews), the rest stays on.
  // crossOriginResourcePolicy cross-origin so the separate frontends can load /uploads images.
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: { maxAge: 15552000, includeSubDomains: true },
      referrerPolicy: { policy: 'no-referrer' },
      frameguard: { action: 'deny' },
    }),
  );
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({
    origin: allowedOrigins?.length ? allowedOrigins : false,
    credentials: true,
  });
  // Serve uploaded payment screenshots as static files
  // Accessible at: GET /uploads/payment-screenshots/<filename>
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const port = process.env.PORT || 3000;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);
  const logger = app.get(Logger);
  logger.log(
    `Application is running on: http://${host}:${port}/${globalPrefix}`,
  );
}

bootstrap();
