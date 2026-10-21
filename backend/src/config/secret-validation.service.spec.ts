import { Logger } from '@nestjs/common';
import { DEFAULT_ADMIN_PASSWORD } from './defaults';
import {
  InsecureProductionConfigException,
  SecretValidationService,
  type SecretHint,
} from './secret-validation.service';

/**
 * TZ-248 — SecretValidationService unit tests.
 *
 * Pure-function `collectHints()` is the public seam we test exhaustively;
 * `assertProductionSafe()` is then validated for its two modes (throw vs
 * warn) and the opt-out escape hatch.
 */
describe('SecretValidationService (TZ-248)', () => {
  const STRONG_JWT = 'a-real-32-character-long-secret-xyz123';
  const STRONG_REFRESH = 'a-different-32-character-refresh-secret-abc456';
  const STRONG_PASSWORD = 'a-strong-password-12345';

  const buildStrongEnv = (): NodeJS.ProcessEnv => ({
    NODE_ENV: 'production',
    JWT_SECRET: STRONG_JWT,
    JWT_REFRESH_SECRET: STRONG_REFRESH,
    ADMIN_USERNAME: 'admin',
    ADMIN_PASSWORD: STRONG_PASSWORD,
  });

  // -----------------------------------------------------------------------
  // collectHints() — pure inspection, no throws
  // -----------------------------------------------------------------------
  describe('collectHints()', () => {
    const findHint = (hints: SecretHint[], key: string, tagFragment: string) =>
      hints.find((h) => h.key === key && h.reason.includes(tagFragment));

    it('returns NO hints when all secrets are strong and unique', () => {
      expect(SecretValidationService.collectHints(buildStrongEnv())).toEqual([]);
    });

    it('flags JWT_SECRET that is shorter than 32 characters (case "dev")', () => {
      const hints = SecretValidationService.collectHints({
        ...buildStrongEnv(),
        JWT_SECRET: 'dev',
      });
      const hint = findHint(hints, 'JWT_SECRET', 'TOO_SHORT');
      expect(hint).toBeDefined();
      expect(hint?.reason).toMatch(/^INSECURE_JWT_SECRET_TOO_SHORT/);
      expect(hint?.reason).toContain('length=3 required>=32');
    });

    it('flags JWT_SECRET containing the literal substring "changeme"', () => {
      const hints = SecretValidationService.collectHints({
        ...buildStrongEnv(),
        JWT_SECRET:
          'changeme-this-string-is-long-enough-to-pass-the-length-rule',
      });
      const hint = findHint(hints, 'JWT_SECRET', 'PLACEHOLDER');
      expect(hint).toBeDefined();
      expect(hint?.reason).toContain('changeme');
    });

    it('flags JWT_SECRET containing the hyphenated placeholder "change-me"', () => {
      const hints = SecretValidationService.collectHints({
        ...buildStrongEnv(),
        // Mirrors the literal currently shipped in `backend/.env.example`.
        JWT_SECRET:
          'change-me-to-a-long-random-string-min-32-chars-here',
      });
      const hint = findHint(hints, 'JWT_SECRET', 'PLACEHOLDER');
      expect(hint).toBeDefined();
      expect(hint?.reason).toContain('change-me');
    });

    it('flags ADMIN_PASSWORD equal to DEFAULT_ADMIN_PASSWORD', () => {
      const hints = SecretValidationService.collectHints({
        ...buildStrongEnv(),
        ADMIN_PASSWORD: DEFAULT_ADMIN_PASSWORD,
      });
      const hint = findHint(
        hints,
        'ADMIN_PASSWORD',
        'INSECURE_ADMIN_PASSWORD_DEFAULT',
      );
      expect(hint).toBeDefined();
    });

    it('flags ADMIN_PASSWORD equal to ADMIN_USERNAME (trivial brute-force)', () => {
      const hints = SecretValidationService.collectHints({
        ...buildStrongEnv(),
        ADMIN_USERNAME: 'admin',
        ADMIN_PASSWORD: 'admin',
      });
      const hint = findHint(
        hints,
        'ADMIN_PASSWORD',
        'INSECURE_ADMIN_PASSWORD_USERNAME',
      );
      expect(hint).toBeDefined();
    });

    it('flags JWT_REFRESH_SECRET identical to JWT_SECRET', () => {
      const hints = SecretValidationService.collectHints({
        ...buildStrongEnv(),
        JWT_SECRET: 'shared-strong-32-character-secret-aaa-123',
        JWT_REFRESH_SECRET: 'shared-strong-32-character-secret-aaa-123',
      });
      const hint = findHint(
        hints,
        'JWT_REFRESH_SECRET',
        'SAME_AS_ACCESS',
      );
      expect(hint).toBeDefined();
    });

    it('flags ADMIN_PASSWORD shorter than 12 characters in production', () => {
      const hints = SecretValidationService.collectHints({
        NODE_ENV: 'production',
        ...buildStrongEnv(),
        ADMIN_USERNAME: 'admin',
        // 10 chars — strictly less than the production 12-char minimum,
        // and chosen so it does NOT accidentally trip any banned-substring
        // marker, the DEFAULT match, or the USERNAME match.
        ADMIN_PASSWORD: 'Ab1c2d3e4f',
      });
      const hint = findHint(hints, 'ADMIN_PASSWORD', 'TOO_SHORT');
      expect(hint).toBeDefined();
      expect(hint?.reason).toMatch(/^INSECURE_ADMIN_PASSWORD_TOO_SHORT/);
      expect(hint?.reason).toContain('length=10 required>=12');
    });

    it('does NOT flag a strong JWT_SECRET that happens to contain "secret" as a literal substring', () => {
      const hints = SecretValidationService.collectHints({
        ...buildStrongEnv(),
        JWT_SECRET: 'a-strong-secret-style-token-with-32-chars-xx',
      });
      expect(hints.filter((h) => h.key === 'JWT_SECRET')).toEqual([]);
    });

    it('does NOT flag a strong ADMIN_PASSWORD that contains the word "password" inside it', () => {
      const hints = SecretValidationService.collectHints({
        ...buildStrongEnv(),
        ADMIN_PASSWORD: 'P@ssword!rotate-me-2026-strong',
      });
      expect(hints.filter((h) => h.key === 'ADMIN_PASSWORD')).toEqual([]);
    });

    it('does NOT flag when DISABLE_SECRET_VALIDATION is set (collected regardless; guard short-circuits)', () => {
      // collectHints is unaware of the opt-out — that flag matters only in
      // assertProductionSafe(). The hints array itself must reflect the env
      // state, regardless of the escape hatch.
      const hints = SecretValidationService.collectHints({
        DISABLE_SECRET_VALIDATION: '1',
        ...buildStrongEnv(),
      });
      expect(hints).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------
  // assertProductionSafe() — production mode throws
  // -----------------------------------------------------------------------
  describe('assertProductionSafe() in production', () => {
    it('throws InsecureProductionConfigException when JWT_SECRET is short', () => {
      expect(() =>
        SecretValidationService.assertProductionSafe({
          NODE_ENV: 'production',
          JWT_SECRET: 'dev',
          JWT_REFRESH_SECRET: STRONG_REFRESH,
          ADMIN_USERNAME: 'admin',
          ADMIN_PASSWORD: STRONG_PASSWORD,
        }),
      ).toThrow(InsecureProductionConfigException);
    });

    it('throws when ADMIN_PASSWORD equals the documented demo default', () => {
      expect(() =>
        SecretValidationService.assertProductionSafe({
          ...buildStrongEnv(),
          ADMIN_PASSWORD: DEFAULT_ADMIN_PASSWORD,
        }),
      ).toThrow(InsecureProductionConfigException);
    });

    it('throws with a message containing INSECURE markers (greppable log pattern)', () => {
      try {
        SecretValidationService.assertProductionSafe({
          NODE_ENV: 'production',
          JWT_SECRET: 'dev',
          JWT_REFRESH_SECRET: 'A-strong-different-refresh-secret-32-chars-x',
          ADMIN_USERNAME: 'admin',
          ADMIN_PASSWORD: 'a-strong-password-12345',
        });
        fail('expected throw, but no exception was raised');
      } catch (err) {
        expect(err).toBeInstanceOf(InsecureProductionConfigException);
        expect((err as Error).message).toMatch(/INSECURE_JWT_SECRET_TOO_SHORT/);
        expect((err as Error).message).toMatch(/TZ-248/);
      }
    });

    it('does NOT throw on a strong production env', () => {
      expect(() =>
        SecretValidationService.assertProductionSafe(buildStrongEnv()),
      ).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // assertProductionSafe() — dev/test mode warns only
  // -----------------------------------------------------------------------
  describe('assertProductionSafe() in dev/test', () => {
    it('does NOT throw on weak secrets in dev mode', () => {
      expect(() =>
        SecretValidationService.assertProductionSafe({
          NODE_ENV: 'development',
          JWT_SECRET: 'dev',
          JWT_REFRESH_SECRET: STRONG_REFRESH,
          ADMIN_PASSWORD: STRONG_PASSWORD,
        }),
      ).not.toThrow();
    });

    it('does NOT throw on weak secrets in test mode', () => {
      expect(() =>
        SecretValidationService.assertProductionSafe({
          NODE_ENV: 'test',
          JWT_SECRET: 'short',
          JWT_REFRESH_SECRET: 'short',
          ADMIN_PASSWORD: 'short',
        }),
      ).not.toThrow();
    });
  });

  // -----------------------------------------------------------------------
  // assertProductionSafe() — opt-out escape hatch
  // -----------------------------------------------------------------------
  describe('assertProductionSafe() with DISABLE_SECRET_VALIDATION=1', () => {
    it('does NOT throw in production when the opt-out is set', () => {
      expect(() =>
        SecretValidationService.assertProductionSafe({
          NODE_ENV: 'production',
          JWT_SECRET: 'dev',
          DISABLE_SECRET_VALIDATION: '1',
        }),
      ).not.toThrow();
    });

    it('does NOT log warn for secrets that would otherwise fail (hint collection is short-circuited)', () => {
      const warnSpy = jest
        .spyOn(Logger, 'warn')
        .mockImplementation(() => undefined);
      try {
        SecretValidationService.assertProductionSafe({
          NODE_ENV: 'production',
          JWT_SECRET: 'dev',
          DISABLE_SECRET_VALIDATION: '1',
        });
        // We only assert the hint-collection branch was skipped — the
        // opt-out path itself logs a single "disabled" line. So recorded
        // warn invocations must reference the opt-out marker, NOT any
        // INSECURE_* reason.
        const allCalls = warnSpy.mock.calls.map((c) => String(c[0] ?? ''));
        const insecureLeak = allCalls.find((m) => /INSECURE_/.test(m));
        expect(insecureLeak).toBeUndefined();
        const optOutMarker = allCalls.find((m) =>
          /DISABLE_SECRET_VALIDATION=1/.test(m),
        );
        expect(optOutMarker).toBeDefined();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('treats unset or non-"1" values as opt-out DISABLED', () => {
      // Empty / "0" / "true" must NOT bypass the guard.
      expect(() =>
        SecretValidationService.assertProductionSafe({
          NODE_ENV: 'production',
          JWT_SECRET: 'dev',
          DISABLE_SECRET_VALIDATION: '0',
        }),
      ).toThrow(InsecureProductionConfigException);
      expect(() =>
        SecretValidationService.assertProductionSafe({
          NODE_ENV: 'production',
          JWT_SECRET: 'dev',
          DISABLE_SECRET_VALIDATION: 'true',
        }),
      ).toThrow(InsecureProductionConfigException);
    });
  });
});
