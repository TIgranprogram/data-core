import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { loginAsAdmin as _loginAsAdmin, authHeader, type AuthTokens } from './test-auth';

/**
 * TZ-95 Phase 1 — Admin fixture for backend e2e tests.
 *
 * Goals:
 *   - Centralize `TEST_ADMIN_PASSWORD` + `TEST_ADMIN_USERNAME` so the 15 e2e
 *     suites in `backend/test/e2e/` stop hardcoding the literal `'admin123456'`
 *     in scattered places (`test-db.ts:51`, `test-auth.ts:13`, `auth.e2e-spec.ts:42,56,71`).
 *   - Provide a single canonical entry point for `loginAsAdmin` + `authHeader`
 *     so future e2e specs import once (`from '../setup/admin.fixture'`) instead
 *     of from two different setup modules.
 *   - Document the env-override path so a developer can override on CI
 *     (`ADMIN_PASSWORD=strongerpwd pnpm test:e2e`).
 *
 * Cross-references:
 *   - TZ-91 §4 Phase A.4 + Phase D (ADMIN_PASSWORD ≥ 8 chars gate).
 *   - TZ-91 Phase B compliance check (`audit-roles-coverage.ts` reads these
 *     same patterns to verify write-endpoint coverage on the test bootstrap path).
 *   - TZ-95 §QA-05:5.2 admin password drift fix.
 */

// Test-side fallback defaults. These are intentionally hardcoded — the
// test bootstrap clears the kppdf-test MongoDB before seeding, so the
// db state is fully controlled by `createTestApp()`.
//
// Rationale: production `.env` ships `ADMIN_PASSWORD=admin12345678`
// (≥8 chars, dev-safe). The test bootstrap intentionally uses a slightly
// DIFFERENT password (`admin123456`) so:
//   (a) the drift between .env and test bootstrap is observable — useful
//       for confirming TZ-91 A.4 admin-seed gate works in dev (different
//       dev seed = .env default).
//   (b) tests can rely on `loginAsAdmin(app)` without having to thread
//       env overrides through every spec.
//
// An operator on CI can override via:
//   `ADMIN_PASSWORD=strongerpwd ADMIN_USERNAME=admin pnpm test:e2e`
// before invoking the test runner.
export const TEST_ADMIN_PASSWORD = 'admin123456';
export const TEST_ADMIN_USERNAME = 'admin';

/**
 * Canonical login helper. Re-exports `loginAsAdmin` from `test-auth.ts`
 * so e2e specs import from one place (`from '../setup/admin.fixture'`)
 * — keeps the public surface small and prevents the "two-import anti-pattern".
 *
 * If a spec needs login overrides (custom username/password), use
 * `loginAsRaw(app, { username, password })` directly from `test-auth.ts`.
 */
export const loginAsAdmin = _loginAsAdmin;

// Confirm: AuthTokens / authHeader re-export so spec imports stay canonical.
export { authHeader, type AuthTokens };
