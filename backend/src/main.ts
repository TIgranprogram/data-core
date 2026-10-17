import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger, BadRequestException } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger as PinoLogger } from 'nestjs-pino';
import * as Sentry from '@sentry/node';
import helmet from 'helmet';
import compression from 'compression';
import { join } from 'path';
import { existsSync } from 'fs';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import {
  flattenValidationErrors,
  HttpExceptionFilter,
} from './common/filters/http-exception.filter';
import { MulterExceptionFilter } from './common/filters/multer-exception.filter';
import { VersionConflictFilter } from './common/filters/version-conflict.filter';
import { ThrottlerBehindAuthGuard } from './common/guards/throttler-behind-auth.guard';
import { createQuietNestLogger } from './common/logging/quiet-nest-logger';
import { SecretValidationService } from './config/secret-validation.service';

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
  // NOTE: Angular production (beasties) may emit
  //   <link rel="stylesheet" media="print" onload="this.media='all'">
  // which needs script-src-attr. Prefer disabling inlineCritical in
  // angular.json; keep a narrow allow here so a rebuild without that
  // flag does not blank the UI again.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          scriptSrcAttr: ["'unsafe-inline'"],
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

  // TZ-BACKEND-DOCSTUDIO-BLOCK-STYLE — self-hosted @font-face files for the
  // document PDF render (dev and prod images share no system font set).
  // Served under /fonts/* → ./assets/fonts/. The PDF pipeline loads the rendered
  // document via page.setContent (null / "about:blank" origin), so the document's
  // @font-face url(...) is a cross-origin fetch. It must be allowed: without an
  // open ACAO/CORP the headless browser silently substitutes a fallback face
  // (the exact „PDF ≠ экран“ trap this TZ exists to close). Web fonts are public
  // assets, so a wildcard ACAO + cross-origin CORP here is the safe conventional
  // choice; Helmet's default same-origin CORP is overridden only for /fonts/*.
  app.use('/fonts/', (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    next();
  });
  app.useStaticAssets(join(process.cwd(), 'assets', 'fonts'), {
    prefix: '/fonts/',
  });

  // Compression
  app.use(compression());

  // TZ-91 §4 Phase A.6: CORS multi-origin — read CORS_ORIGIN (preferred, new convention) or
  // CORS_ORIGINS (legacy, deprecated). Comma-separated list, trimmed, empty handlers dropped.
  // Desktop (Tauri 2):
  // - dev: http://localhost:1420
  // - Windows packaged WebView2: http://tauri.localhost (default scheme)
  // - macOS/Linux / optional https scheme: tauri://localhost, https://tauri.localhost
  const corsEnv = process.env.CORS_ORIGIN ?? process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:4200';
  const corsOrigins = corsEnv.split(',').map((o) => o.trim()).filter(Boolean);
  for (const desktopOrigin of [
    'http://localhost:1420',
    'http://tauri.localhost',
    'tauri://localhost',
    'https://tauri.localhost',
  ]) {
    if (!corsOrigins.includes(desktopOrigin)) corsOrigins.push(desktopOrigin);
  }
  app.enableCors({
    origin: corsOrigins.length === 1 ? corsOrigins[0] : corsOrigins,
    credentials: true,
  });

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

  // TZ-DOC-323: a `category` field in a text-block payload was the most
  // likely legacy property to slip through here. We surface a friendly
  // operator-actionable message naming the canonical replacement
  // (`categoryId`) on `forbidNonWhitelisted` failures, instead of the
  // generic `property <name> should not exist`.
  //
  // Probe (src/main.ts / DTO:CreateTextBlockDto) confirms the error
  // shape class-validator emits for whitelist rejections:
  //   errors[i].property           = the rejected property name ('category')
  //   errors[i].constraints.whitelistValidation
  //                                 = the canonical message
  //   errors[i].value               = the rejected value
  // Anything else uses the standard default message.
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
            if (err.property === 'category') {
              // TZ-DOC-323 — the legacy enum was removed; surface a
              // domain-aware message.
              lines.push(
                `Property 'category' is no longer accepted on this endpoint. ` +
                  `It was a legacy enum introduced pre-TZ-DOC-315 and removed by TZ-DOC-323. ` +
                  `Use 'categoryId' instead (a 24-hex ObjectId of a TextBlockCategory).`,
              );
            } else {
              // Other unknown properties keep the canonical class-validator
              // message verbatim so unrelated 4xx shapes are untouched.
              lines.push(wlm);
            }
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

  // Desktop installer (TZD-16/24) under /downloads/*. Prefer a folder that
  // actually contains the ZIP/exe (staging or published SPA tree).
  // Local FE (:4200) proxies /downloads → here (proxy.conf.json).
  // Never SPA-fallback these paths (see production middleware below).
  const downloadDirs = [
    process.env.FRONTEND_PATH ? join(process.env.FRONTEND_PATH, 'downloads') : '',
    join(process.cwd(), '..', 'frontend', 'browser', 'downloads'),
    join(process.cwd(), '..', 'frontend', 'downloads'),
    join(process.cwd(), 'frontend', 'browser', 'downloads'),
    join(process.cwd(), 'frontend', 'downloads'),
  ].filter((d) => d && existsSync(d));
  const downloadDirWithInstaller = downloadDirs.find(
    (d) =>
      existsSync(join(d, 'kppdf-desktop-setup.zip')) ||
      existsSync(join(d, 'kppdf-desktop-setup.exe')),
  );
  if (downloadDirWithInstaller || downloadDirs.length > 0) {
    const dir = downloadDirWithInstaller ?? downloadDirs[0]!;
    app.useStaticAssets(dir, { prefix: '/downloads/' });
    Logger.log(`📥 Desktop downloads: ${dir}`, 'Bootstrap');
    if (!downloadDirWithInstaller) {
      Logger.warn(
        '📥 /downloads mounted but no kppdf-desktop-setup.zip|.exe — run: pnpm --dir desktop publish-installer',
        'Bootstrap',
      );
    }
  }

  // Production: serve built Angular SPA from FRONTEND_PATH (Synology/docker deploy).
  const frontendPath = process.env.FRONTEND_PATH;
  if (process.env.NODE_ENV === 'production' && frontendPath) {
    app.useStaticAssets(frontendPath, { index: false });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      const p = req.path;
      if (p.startsWith('/api') || p.startsWith('/uploads')) return next();
      // TZD-24: installer ZIP/exe — never fall back to SPA index.html
      // (prod bug: GET /downloads/*.exe returned ~1.5KB HTML → CSP noise).
      if (p.startsWith('/downloads')) return next();
      res.sendFile(join(frontendPath, 'index.html'), (err: Error | null) => {
        if (err) next(err);
      });
    });
    Logger.log(`📦 Frontend static: ${frontendPath}`, 'Bootstrap');
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('KPPDF API')
    .setDescription('Backend API for kppdf-8.0 ERP system')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
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
