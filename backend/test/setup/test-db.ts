import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { MongooseModule, getConnectionToken } from '@nestjs/mongoose';
import { Connection, connect, type Mongoose } from 'mongoose';
import { AppModule } from '../../src/app.module';
import { TEST_ADMIN_PASSWORD } from './admin.fixture';

export interface TestContext {
  app: INestApplication;
  module: TestingModule;
  connection: Connection;
  cleanup: () => Promise<void>;
}

/**
 * Creates a NestJS testing application backed by a fresh `kppdf-test`
 * MongoDB database.
 *
 * CRITICAL: Before bootstrapping the app, we delete every collection in
 * the test database individually (NOT `dropDatabase()`, which puts the
 * database in a "being dropped" state and causes subsequent seed
 * operations to fail with `MongoBulkWriteError: Cannot create collection
 * - database is in the process of being dropped`).
 *
 * After clearing, `app.init()` triggers `OnApplicationBootstrap` seeds
 * (AdminSeed, SettingsSeed, UnitsSeed, OrgRolesSeed,
 * CounterpartyRolesSeed, FeatureFlagsSeed, StatusesSeed) on a truly
 * empty database — so the admin user is always created with the test
 * password.
 *
 * Must be run with `jest --runInBand` so that only one suite bootstraps
 * at a time (each suite clears + re-seeds the same `kppdf-test` db).
 */
export async function createTestApp(): Promise<TestContext> {
  const testDb = process.env.MONGO_DB_TEST ?? 'kppdf-test';
  process.env.MONGO_DB = testDb;
  process.env.NODE_ENV = 'test';
  process.env.DISABLE_THROTTLE = '1';
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'test-secret-min-16-chars-long';
  process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET ?? 'test-refresh-secret-min-16-chars';
  // Use a test-specific password that satisfies Joi min(8) validation.
  // The .env default 'admin-change-me-immediately-in-production' is too
  // long for tests; 'admin' (5 chars) fails Joi validation.
  // Imported from admin.fixture (TZ-95) — single source of truth for the
  // 5 places that previously hardcoded this literal.
  process.env.ADMIN_PASSWORD = TEST_ADMIN_PASSWORD;

  // --- Pre-init: clear all collections so seeds run fresh ---
  const mongoUri =
    process.env.MONGO_URI ?? 'mongodb://localhost:27017/kppdf?replicaSet=rs0&directConnection=true';
  // Replace the database name in the URI with the test database name.
  const testUri = mongoUri.replace(/\/[^/?]+(\?|$)/, `/${testDb}$1`);
  const preMongoose: Mongoose = await connect(testUri);
  try {
    const db = preMongoose.connection.db;
    if (db) {
      const collections = await db
        .listCollections()
        .toArray();
      for (const col of collections) {
        try {
          await preMongoose.connection.dropCollection(col.name);
        } catch {
          // Collection may already be gone — safe to ignore.
        }
      }
    }
  } catch {
    // Database may not exist yet — safe to ignore.
  }
  await preMongoose.disconnect();

  // --- Bootstrap NestJS app (seeds run during init) ---
  const module = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = module.createNestApplication({ logger: false });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');
  await app.init();

  const connection = app.get<Connection>(getConnectionToken());

  const cleanup = async () => {
    try {
      // Delete all collections individually (same rationale as pre-init).
      const db = connection.db;
      if (db) {
        const collections = await db.listCollections().toArray();
        for (const col of collections) {
          try {
            await connection.dropCollection(col.name);
          } catch {
            // Collection may already be gone.
          }
        }
      }
    } catch {
      // Connection may already be closed — safe to ignore.
    }
    try {
      await app.close();
    } catch {
      // App may already be closed.
    }
    try {
      await module.close();
    } catch {
      // Module may already be closed.
    }
  };

  return { app, module, connection, cleanup };
}

export async function clearCollections(connection: Connection, names: string[]): Promise<void> {
  for (const name of names) {
    try {
      await connection.dropCollection(name);
    } catch {
      // Collection may not exist yet — safe to ignore.
    }
  }
}
