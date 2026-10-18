import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, BadRequestException } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import * as Sentry from '@sentry/node';
import helmet from 'helmet';
import compression from 'compression';
import { join } from 'path';
import { existsSync } from 'fs';
import { AppModule } from './app.module';
import { buildSwaggerConfig } from './swagger.config';
import {
  flattenValidationErrors,
  HttpExceptionFilter,
} from './common/filters/http-exception.filter';
import { MulterExceptionFilter } from './common/filters/multer-exception.filter';
import { VersionConflictFilter } from './common/filters/version-conflict.filter';
import { ThrottlerBehindAuthGuard } from './common/guards/throttler-behind-auth.guard';
import { createQuietNestLogger } from './common/logging/quiet-nest-logger';
import { SecretValidationService } from './config/secret-validation.service';
import { registerAppDataBodyParser } from './modules/app-data/app-data.body-parser';

async function bootstrap() {
  // TZ-157: Initialize Sentry before NestJS so exceptions in bootstrap are captured
  const sentryDsn = process.env.SENTRY_DSN;
  if (sentryDsn) {
    Sentry.init({
      dsn: sentryDsn,
      environment: process.env.NODE_ENV ?? 'development',
      tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,
    });
  }

  // TZ-248: production secret-validation guard. Runs AFTER Sentry.init so
  // fatal failures get a chance to be reported, but BEFORE NestFactory.create()
  // so insecure configs never reach DB / DI / Mongo. Production throws ->
  // exit 1. Dev/test logs warnings via NestJS Logger only. Opt-out is
  // explicit-string `DISABLE_SECRET_VALIDATION=1` (see
  // docs/SECURITY-OPERATIONS.md for the opt-out policy).
  try {
    SecretValidationService.assertProductionSafe(process.env);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Unknown rejection reason';
    Logger.error(
      `⛔ Production safety guard rejected the environment (TZ-248) — halting boot.\n${message}`,
      'Bootstrap',
    );
    // TZ-157 contract: flush Sentry so the TZ-248 rejection reaches the
    // dashboard before we tear the process down. 2-second budget; if Sentry
    // does not respond in time we still exit 1 — log-only failure is worse
    // than a slightly-delayed exit.
    if (sentryDsn) {
      try {
        Sentry.captureException(err);
        await Sentry.flush(2000);
      } catch (sentryErr) {
        Logger.warn(
          `Sentry.flush failed during TZ-248 halt path: ${
            sentryErr instanceof Error ? sentryErr.message : String(sentryErr)
          }`,
          'Bootstrap',
        );
      }
    }
    process.exit(1);
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  // TZ-OPS-301: mute Nest DI INFO spam (InstanceLoader / RoutesResolver / …).
  // warn/error always pass; NEST_BOOT_VERBOSE=1 or LOG_LEVEL=debug → full dump.
  // TZ-248 secret WARN runs above via Nest Logger before create — untouched.
  app.useLogger(createQuietNestLogger(app.get(PinoLogger)));

  // Helmet with CSP and HSTS hardening.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          frameAncestors: ["'self'"],
          upgradeInsecureRequests: [],
        },
      },
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    }),
  );

  // Static serve for uploaded photos at /uploads/* → ./uploads/
  app.useStaticAssets(join(process.cwd(), 'uploads'), {
    prefix: '/uploads/',
  });

  // Personal Data Core — статическая админка (без сборки, vanilla JS).
  // Отдаётся с того же origin на /admin (index.html + admin.js + admin.css).
  // Живёт в ./admin рядом с dist/ (в Docker — скопирована в /app/admin).
  const adminDir = join(__dirname, '..', 'admin');
  const adminDirCwd = join(process.cwd(), 'admin');
  const adminPath = existsSync(adminDir) ? adminDir : adminDirCwd;
  if (existsSync(adminPath)) {
    app.useStaticAssets(adminPath, { prefix: '/admin/' });
    Logger.log(`🛠  Admin UI: /admin (from ${adminPath})`, 'Bootstrap');
  } else {
    Logger.warn(`Admin UI dir not found (${adminPath}) — /admin disabled`, 'Bootstrap');
  }

  // Compression
  app.use(compression());

  // TZ-91 §4 Phase A.6: CORS multi-origin — read CORS_ORIGIN (preferred, new convention) or
  // CORS_ORIGINS (legacy, deprecated). Comma-separated list, trimmed, empty handlers dropped.
  // Разрешены только origin'ы из env — никаких неявных добавок.
  const corsEnv = process.env.CORS_ORIGIN ?? process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:4200';
  const corsOrigins = corsEnv.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    credentials: true,
  });

  // P1: /api/apps принимает документы до 256 КБ и bulk — стандартных 100 КБ мало.
  registerAppDataBodyParser(app);

  // TZ-249 §2.1 — TRUST_PROXY=1 explicitly opts into trusting
  // X-Forwarded-For for downstream guards. Default is FALSE: spoofable
  // headers cannot reach the throttle tracker.
  app.set('trust proxy', process.env.TRUST_PROXY === '1');

  // TZ-249 §2.1 — DISABLE_THROTTLE has NO effect in production. A
  // non-empty value in production halts the boot before the NestJS
  // global guards pipe is wired up. Mirrored inside
  // ThrottlerBehindAuthGuard.shouldSkip() for defence-in-depth.
  const disableThrottleRaw = process.env.DISABLE_THROTTLE;
  if (
    process.env.NODE_ENV === 'production' &&
    disableThrottleRaw !== undefined &&
    disableThrottleRaw !== ''
  ) {
    Logger.error(
      `⛔ DISABLE_THROTTLE=${disableThrottleRaw} is not allowed in production (TZ-249) — halting boot.`,
      'Bootstrap',
    );
    if (sentryDsn) {
      try {
        Sentry.captureException(
          new Error(`DISABLE_THROTTLE in production (TZ-249) = ${disableThrottleRaw}`),
        );
        await Sentry.flush(2000);
      } catch (sentryErr) {
        Logger.warn(
          `Sentry.flush failed during DISABLE_THROTTLE halt path: ${
            sentryErr instanceof Error ? sentryErr.message : String(sentryErr)
          }`,
          'Bootstrap',
        );
      }
    }
    process.exit(1);
  }

  // Global throttler (skips ONLY when dev/test AND DISABLE_THROTTLE=1).
  // In production DISABLE_THROTTLE is rejected above, so the condition
  // simplifies to "always install in prod".
  if (disableThrottleRaw !== '1') {
    app.useGlobalGuards(app.get(ThrottlerBehindAuthGuard));
  } else {
    Logger.warn(
      'Throttler disabled via DISABLE_THROTTLE=1 (dev/test only) — TZ-249 invariant in production is enforced elsewhere',
      'Bootstrap',
    );
  }

  // Whitelist-ошибки отдаются каноническим сообщением class-validator
  // (`property <name> should not exist`).
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const lines: string[] = [];
        for (const err of errors) {
          const wlm = err.constraints?.whitelistValidation;
          if (wlm) {
            lines.push(wlm);
          } else {
            // Nested validation errors are flattened before they reach the
            // global filter, preserving the full property path for operators.
            lines.push(...flattenValidationErrors([err]));
          }
        }
        return lines.length
          ? new BadRequestException(lines.join('; '))
          : new BadRequestException('Validation failed');
      },
    }),
  );

  // TZ-86 Phase A.6 — Multer errors (LIMIT_FILE_SIZE etc.) get specific HTTP
  // codes (413 for oversize, 400 for unexpected field) before falling through
  // to HttpExceptionFilter for everything else. More-specific @Catch(MulterError)
  // filter is registered first; the global catch-all backs it up.
  app.useGlobalFilters(new VersionConflictFilter(), new MulterExceptionFilter(), new HttpExceptionFilter());
  app.setGlobalPrefix('api');

  const swaggerConfig = buildSwaggerConfig();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // TZ-91 §4 Phase C.1: Swagger gated by NODE_ENV !== 'production'.
  // Escape hatch: SWAGGER_ENABLED='true' for prod-debug scenarios only.
  // Strict `=== 'true'` (no truthy coercion) avoids accidental enabling
  // via SWAGGER_ENABLED=1 or SWAGGER_ENABLED=yes (both intentionally rejected
  // — code-reviewer MINOR cross-cutting decision).
  const swaggerEnabled =
    process.env.NODE_ENV !== 'production' ||
    process.env.SWAGGER_ENABLED === 'true';
  if (swaggerEnabled) {
    SwaggerModule.setup('docs', app, document);
  } else {
    Logger.log('Swagger UI disabled in production (set SWAGGER_ENABLED=true to override)', 'Bootstrap');
  }

  // Graceful shutdown
  app.enableShutdownHooks();
  const shutdown = async (signal: string) => {
    Logger.log(`Received ${signal}, starting graceful shutdown...`, 'Bootstrap');
    try {
      await app.close();
      Logger.log('HTTP server closed', 'Bootstrap');
      process.exit(0);
    } catch (err) {
      Logger.error(`Shutdown error: ${err instanceof Error ? err.message : String(err)}`, 'Bootstrap');
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);

  const url = await app.getUrl();
  Logger.log(`🚀 Backend started on ${url}`, 'Bootstrap');
  Logger.log(`📚 Swagger UI: ${url}/docs`, 'Bootstrap');
  Logger.log(`❤️  Health: ${url}/api/health`, 'Bootstrap');
}

void bootstrap();
