import { Logger } from '@nestjs/common';
import {
  DEFAULT_ADMIN_PASSWORD,
} from './defaults';

/**
 * Production secret-validation guard.
 *
 * **WHY** (TZ-248): Joi via `env.validation.ts` enforces minimum syntactic
 * constraints (`length >= 16` for JWT, `length >= 8` for ADMIN_PASSWORD) but
 * does **NOT** detect known weak-*placeholder* patterns like `dev`, `changeme`,
 * `change-me`, `do-not-use`, `placeholder`, `example`. Operators who copy
 * `.env.example` straight into a production deployment would pass Joi but
 * ship with a JWT_SECRET any attacker can guess.
 *
 * This guard is the second layer: it inspects every credential-bearing env
 * value against a curated set of weak hints, throws `InsecureProductionConfigException`
 * if NODE_ENV=production, and **warns** in dev/test so dev warnings still
 * help catch accidental drift before promotion.
 *
 * **WHEN:** runs synchronously inside `bootstrap()` AFTER `Sentry.init` and
 * BEFORE `NestFactory.create()`. No DI deps: pure static class because the
 * NestJS DI graph has not been built at this point.
 *
 * **DISABLE escape hatch:** `process.env.DISABLE_SECRET_VALIDATION === '1'` —
 * explicit-string equality, matching the opt-out convention used by
 * `AdminPasswordDriftDetector` next door. Never automatic; operator must
 * opt out deliberately. Documented as an `OPERATIONAL ACTION` in
 * `docs/SECURITY-OPERATIONS.md`.
 */

/** Thrown by `SecretValidationService.assertProductionSafe` in production. */
export class InsecureProductionConfigException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsecureProductionConfigException';
  }
}

export interface SecretHint {
  /** Env key name, e.g. `JWT_SECRET`. */
  key: string;
  /**
   * Grep-friendly reason string, prefixed with `INSECURE_<KEY>_<TAG>` so
   * log-scanners can grep production boot logs for known markers.
   */
  reason: string;
}

/**
 * Lowercase substring patterns that mark a value as placeholder leakage.
 * Intentionally narrow to keep false-positive rate near zero in
 * legitimate dev workflows that happen to contain words like "secret"
 * or "password" as substrings of real secrets. The list is owned by
 * the security runbook (`docs/SECURITY-OPERATIONS.md §3.2`) — any new
 * placeholder convention must be added both here and in the doc.
 */
const BANNED_PLACEHOLDER_SUBSTRINGS: readonly string[] = [
  'changeme',
  'change-me',
  'do-not-use',
  'placeholder',
  'example',
];

interface HintedRules {
  /** Minimum length enforced only when NODE_ENV=production. */
  minProdLength: number;
  /** Reference to the shared banned-substring list. */
  bannedSubstrings: readonly string[];
}

const HINTED_RULES_BY_KEY: Record<string, HintedRules> = {
  JWT_SECRET: {
    minProdLength: 32,
    bannedSubstrings: BANNED_PLACEHOLDER_SUBSTRINGS,
  },
  JWT_REFRESH_SECRET: {
    minProdLength: 32,
    bannedSubstrings: BANNED_PLACEHOLDER_SUBSTRINGS,
  },
  ADMIN_PASSWORD: {
    minProdLength: 12,
    bannedSubstrings: BANNED_PLACEHOLDER_SUBSTRINGS,
  },
};

const HINTED_KEYS = Object.keys(HINTED_RULES_BY_KEY);

export class SecretValidationService {
  /**
   * Collect weak-secret hints from a process.env snapshot.
   *
   * Pure function — does not inspect any other state, does not throw, does
   * not log. Visible to tests; not part of the public startup API.
   *
   * Returns an empty array when no hints are present.
   */
  static collectHints(env: NodeJS.ProcessEnv): SecretHint[] {
    const hints: SecretHint[] = [];

    for (const key of HINTED_KEYS) {
      const value = env[key] ?? '';
      const lower = value.toLowerCase();
      const rules = HINTED_RULES_BY_KEY[key];

      // Production minimum-length rule.
      // In dev/test we tolerate the smaller Joi minimum — the goal here is
      // to catch PLACEHOLDER leakage in prod, not regress dev ergonomics.
      if (value.length < rules.minProdLength) {
        hints.push({
          key,
          reason: `INSECURE_${key}_TOO_SHORT length=${value.length} required>=${rules.minProdLength}`,
        });
        continue;
      }

      // Substring scan for known placeholder markers.
      // The list is intentionally narrow — only markers that operators use
      // when "leaving a TODO" — to keep false-positive rate near zero in
      // legitimate dev workflows. The generic words "secret" and "password"
      // are intentionally NOT banned because real production secrets can
      // legitimately contain them (e.g. `my-strong-secret-key-…` is fine).
      const matched = rules.bannedSubstrings.find((s) => lower.includes(s));
      if (matched) {
        hints.push({
          key,
          reason: `INSECURE_${key}_PLACEHOLDER contains="${matched}"`,
        });
      }
    }

    const admin = env.ADMIN_PASSWORD ?? '';
    const adminUser = env.ADMIN_USERNAME ?? '';

    // Equal to documented dangerous default → never acceptable in prod.
    // DEFAULT_ADMIN_PASSWORD is the literal `admin-change-me-immediately-in-production`,
    // so this branch MUST trip when `.env.example` is copied wholesale.
    if (admin.length > 0 && admin === DEFAULT_ADMIN_PASSWORD) {
      hints.push({
        key: 'ADMIN_PASSWORD',
        reason:
          'INSECURE_ADMIN_PASSWORD_DEFAULT matches documented demo default',
      });
    }

    // Equal to the username → trivially brute-forceable.
    if (admin.length > 0 && adminUser.length > 0 && admin === adminUser) {
      hints.push({
        key: 'ADMIN_PASSWORD',
        reason:
          'INSECURE_ADMIN_PASSWORD_USERNAME equals ADMIN_USERNAME (brute-force trivial)',
      });
    }

    const jwtA = env.JWT_SECRET ?? '';
    const jwtR = env.JWT_REFRESH_SECRET ?? '';
    if (jwtA.length > 0 && jwtR.length > 0 && jwtA === jwtR) {
      hints.push({
        key: 'JWT_REFRESH_SECRET',
        reason:
          'INSECURE_JWT_REFRESH_SECRET_SAME_AS_ACCESS must differ from JWT_SECRET',
      });
    }

    return hints;
  }

  /**
   * Throw `InsecureProductionConfigException` in production if any hint exists;
   * log via NestJS `Logger.warn` in dev/test.
   *
   * Disabled explicitly via `DISABLE_SECRET_VALIDATION=1` — same opt-out
   * convention as `AdminPasswordDriftDetector` next door.
   */
  static assertProductionSafe(env: NodeJS.ProcessEnv): void {
    if (env.DISABLE_SECRET_VALIDATION === '1') {
      Logger.warn(
        '⏭️  SecretValidationService disabled via DISABLE_SECRET_VALIDATION=1 (TZ-248 opt-out)',
        'Bootstrap',
      );
      return;
    }

    const hints = SecretValidationService.collectHints(env);
    if (hints.length === 0) return;

    const detail = hints.map((h) => `  - ${h.reason}`).join('\n');

    if (env.NODE_ENV === 'production') {
      throw new InsecureProductionConfigException(
        `Insecure production environment rejected (TZ-248).\n` +
          `Detected weak secret markers — fix before promoting to production:\n` +
          `${detail}\n` +
          `See docs/SECURITY-OPERATIONS.md for the rotation procedure.`,
      );
    }

    Logger.warn(
      `⚠️ Weak secret markers detected (TZ-248 — allow-listed in dev/test, will FAIL in production):\n${detail}`,
      'Bootstrap',
    );
  }
}
