import { PermissionsBootValidator } from './permissions-boot-validator';

/**
 * TZ-255 §ШАГ 5 — Unit spec for the boot validator.
 *
 * Tests the static `validateKeys` helper. The live
 * `OnApplicationBootstrap` path requires a real Nest container which
 * is outside unit-test scope (covered by an e2e if added later).
 * The static helper applies the same logic the live hook runs.
 */
describe('PermissionsBootValidator.validateKeys (TZ-255 §ШАГ 4)', () => {
  const catalog = new Set([
    'material:read', 'material:write',
    'user:read', 'user:write', 'user:admin',
  ]);

  it('returns [] for undefined metadata', () => {
    expect(PermissionsBootValidator.validateKeys(undefined, catalog)).toEqual([]);
  });

  it('returns [] when all keys are canonical', () => {
    expect(
      PermissionsBootValidator.validateKeys(['material:read', 'user:write'], catalog),
    ).toEqual([]);
  });

  it('returns the offending keys when at least one is non-canonical', () => {
    expect(
      PermissionsBootValidator.validateKeys(
        ['material:read', 'bad:key', 'product:danger'],
        catalog,
      ),
    ).toEqual(['bad:key', 'product:danger']);
  });

  it('accepts "*" (wildcard) regardless of catalog', () => {
    expect(
      PermissionsBootValidator.validateKeys(['*'], catalog),
    ).toEqual([]);
  });

  it('returns [] when the required list is empty', () => {
    expect(PermissionsBootValidator.validateKeys([], catalog)).toEqual([]);
  });

  it('preserves order of violations (helps in stack traces)', () => {
    const out = PermissionsBootValidator.validateKeys(
      ['zzz:first', 'aaa:second', 'bbb:third'],
      catalog,
    );
    expect(out).toEqual(['zzz:first', 'aaa:second', 'bbb:third']);
  });
});
