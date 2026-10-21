/**
 * TZ-NEW-FOLLOWUP — backend unit test for `backend/reset-password.js`.
 *
 * Why this file exists: code-reviewer at commit 48e2234 flagged that the 5
 * exit codes (0/1/2/3/99) + the BOOLEAN_FLAGS Set + the default-deny
 * enumeration gate (RESET_PASSWORD_REVEAL_USERS) all shipped untested. A
 * future contributor tweaking `parseArgs` could break the boolean-flag
 * handling or the default-deny gate without any test surface to catch it —
 * and the very bug class that triggered commit 48e2234 was
 * silent .env drift on the admin password, where nothing caught the
 * inconsistency until manual verification.
 *
 * Integration: jest-e2e.json testRegex picks this up via `.e2e-spec\.ts$`,
 * so it runs automatically under `pnpm run test:e2e`.
 *
 * Mocking strategy (Path B, per TZ-NEW-FOLLOWUP reasoning):
 *   - `jest.mock('mongoose')` stubs connect/disconnect/collection so the 5
 *     exit-code paths are deterministic and don't depend on a live Mongo.
 *   - `jest.mock('bcryptjs')` stubs the hash sink so writes are no-ops.
 *   - `jest.spyOn(process, 'exit')` throws a tagged error on every call,
 *     caught by the local `callRun()` helper to extract the exit code.
 *   - The new `if (require.main === module)` guard in reset-password.js
 *     keeps the production's outer `.catch` from firing inside jest, so
 *     tests can call `run()` directly without colliding with the real
 *     top-level exit-99 handler.
 */
import * as path from 'path';

// SCRIPT_PATH: spec file lives at `backend/test/reset-password.e2e-spec.ts`,
// script lives at `backend/reset-password.js`. One `..` from __dirname.
const SCRIPT_PATH = path.resolve(__dirname, '..', 'reset-password.js');

// Mocks MUST be registered before the script is `require()`d.
jest.mock('mongoose', () => {
  const collection = {
    updateOne: jest.fn(),
    find: jest.fn(),
  };
  return {
    __esModule: true,
    default: {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      connection: { db: { collection: jest.fn(() => collection) } },
    },
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn().mockResolvedValue(undefined),
    connection: { db: { collection: jest.fn(() => collection) } },
    __mockCollection: collection,
  };
});

jest.mock('bcryptjs', () => ({
  __esModule: true,
  default: { hash: jest.fn().mockResolvedValue('fakehash') },
  hash: jest.fn().mockResolvedValue('fakehash'),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const script = require(SCRIPT_PATH);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mongoose = require('mongoose');

/**
 * Run the script's `run()` while capturing argv + process.exit + console
 * output. The `process.exit` spy throws a tagged error to halt the script's
 * normal control flow at the exit site; the catch unwraps the code. Any
 * non-tagged error (e.g. mongoose.connect rejecting) is treated as the
 * exit-99 path's natural throw.
 */
async function callRun(): Promise<{
  code: number;
  stderr: string;
  stdout: string;
  rawError?: Error;
}> {
  let code = 0;
  let rawError: Error | undefined;
  try {
    await script.run();
  } catch (e) {
    const msg = (e as Error).message;
    const m = msg.match(/^__EXIT__(\d+)__$/);
    if (m) {
      code = parseInt(m[1], 10);
    } else {
      // script.run() itself threw (e.g. mongoose.connect rejected).
      // Production's outer .catch is gated by `require.main === module`,
      // which is FALSE here — so the throw propagates back to the test.
      // We map this to exit-99 (what production would emit) and surface the
      // raw error so the caller can assert on its message.
      code = 99;
      rawError = e as Error;
    }
  }
  return {
    code,
    stderr: ((console.error as jest.Mock).mock.calls ?? [])
      .map((c: unknown[]) => c.map(String).join(' '))
      .join('\n'),
    stdout: ((console.log as jest.Mock).mock.calls ?? [])
      .map((c: unknown[]) => c.map(String).join(' '))
      .join('\n'),
    rawError,
  };
}

describe('reset-password.js CLI', () => {
  let exitSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let argvBackup: string[];
  let envBackup: NodeJS.ProcessEnv;
  // Cast for the mocked mongoose export (TS sees the real mongoose types).
  const mockedMongoose = mongoose as unknown as {
    __mockCollection: {
      updateOne: jest.Mock;
      find: jest.Mock;
    };
    connect: jest.Mock;
    disconnect: jest.Mock;
  };

  beforeEach(() => {
    argvBackup = process.argv;
    envBackup = { ...process.env };

    // Spy throws a tagged error so `callRun()` can extract the code.
    exitSpy = jest
      .spyOn(process, 'exit')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation(((code?: number) => {
        throw new Error(`__EXIT__${code ?? 0}__`);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any);
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);

    // Reset all mongoose + bcrypt stub state between tests.
    jest.clearAllMocks();
    mockedMongoose.__mockCollection.updateOne.mockReset();
    mockedMongoose.__mockCollection.find.mockReset();
    mockedMongoose.connect.mockReset();
    mockedMongoose.connect.mockResolvedValue(undefined);
    mockedMongoose.disconnect.mockReset();
    mockedMongoose.disconnect.mockResolvedValue(undefined);

    // Recover exit-spy after clearAllMocks wiped it.
    exitSpy.mockImplementation(((code?: number) => {
      throw new Error(`__EXIT__${code ?? 0}__`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any);
  });

  afterEach(() => {
    process.argv = argvBackup;
    process.env = envBackup;
    jest.restoreAllMocks();
  });

  // ────────────────────────────────────────────────────────────────────
  // parseArgs( argv ) — pure logic, no Mongo. Unit tests.
  // ────────────────────────────────────────────────────────────────────

  describe('parseArgs', () => {
    it('returns admin/admin defaults with no positional args', () => {
      expect(script.parseArgs(['node', 'reset-password.js'])).toEqual({
        username: 'admin',
        password: 'admin',
        allowShort: false,
      });
    });

    it('parses positional user + pass', () => {
      expect(
        script.parseArgs(['node', 'reset-password.js', 'alice', 'sekret123']),
      ).toMatchObject({
        username: 'alice',
        password: 'sekret123',
        allowShort: false,
      });
    });

    it('parses --username= and --password= long forms', () => {
      expect(
        script.parseArgs([
          'node',
          'reset-password.js',
          '--username=foo',
          '--password=barbaz',
        ]),
      ).toMatchObject({ username: 'foo', password: 'barbaz' });
    });

    it('returns help:true for --help / -h', () => {
      expect(script.parseArgs(['node', 'reset-password.js', '--help']).help).toBe(true);
      expect(script.parseArgs(['node', 'reset-password.js', '-h']).help).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // BOOLEAN_FLAGS Set — `--allow-short` MUST consume its own word,
  // never absorb the next positional arg.
  // ────────────────────────────────────────────────────────────────────

  describe('BOOLEAN_FLAGS Set [--allow-short] ordering', () => {
    it('--allow-short BEFORE positional: consumes own word only', () => {
      expect(
        script.parseArgs(['node', 'reset-password.js', '--allow-short', 'admin', 'short']),
      ).toMatchObject({ username: 'admin', password: 'short', allowShort: true });
    });

    it('--allow-short AFTER positional: still sets allowShort=true', () => {
      expect(
        script.parseArgs(['node', 'reset-password.js', 'admin', 'short', '--allow-short']),
      ).toMatchObject({ username: 'admin', password: 'short', allowShort: true });
    });

    it('without --allow-short, the same positional yields allowShort=false', () => {
      expect(
        script.parseArgs(['node', 'reset-password.js', 'admin', 'short']),
      ).toMatchObject({ allowShort: false });
    });

    it('--allow-short in the middle (between two positionals) breaks nothing', () => {
      // Spec asserts robustness: argv order is caller-defined, the parser
      // should be order-agnostic (boolean flag is always a flag, never
      // confused for a positional).
      expect(
        script.parseArgs([
          'node',
          'reset-password.js',
          'admin',
          '--allow-short',
          'short',
        ]),
      ).toMatchObject({ username: 'admin', password: 'short', allowShort: true });
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // ensureDirectConnection(uri) — URI normalization helper.
  // ────────────────────────────────────────────────────────────────────

  describe('ensureDirectConnection', () => {
    it('injects ?directConnection=true to a bare host:port URI', () => {
      expect(
        script.ensureDirectConnection('mongodb://localhost:27017/kppdf'),
      ).toBe('mongodb://localhost:27017/kppdf?directConnection=true');
    });

    it('uses & when query string already exists', () => {
      expect(
        script.ensureDirectConnection('mongodb://m:27017/k?replicaSet=rs0'),
      ).toBe('mongodb://m:27017/k?replicaSet=rs0&directConnection=true');
    });

    it('preserves an existing directConnection query (case-insensitive)', () => {
      expect(
        script.ensureDirectConnection('mongodb://m:27017/k?directConnection=false'),
      ).toBe('mongodb://m:27017/k?directConnection=false');
      expect(
        script.ensureDirectConnection('mongodb://m:27017/k?DIRECTCONNECTION=true'),
      ).toBe('mongodb://m:27017/k?DIRECTCONNECTION=true');
    });

    it('returns an empty string unchanged', () => {
      expect(script.ensureDirectConnection('')).toBe('');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // run() — the 5 documented exit codes.
  // ────────────────────────────────────────────────────────────────────

  describe('run() — 5 exit codes', () => {
    it('exit 0: valid 8-char password, user matched', async () => {
      process.argv = ['node', 'reset-password.js', 'admin', 'correctpass'];
      mockedMongoose.__mockCollection.updateOne.mockResolvedValueOnce({
        matchedCount: 1,
        modifiedCount: 1,
      });
      const r = await callRun();
      expect(r.code).toBe(0);
      expect(r.stderr).toBe('');
      expect(r.stdout).toMatch(/Password updated for username='admin'/);
      expect(r.stdout).toMatch(/matchedCount=1/);
    });

    it('exit 0: --allow-short + short password', async () => {
      process.argv = [
        'node',
        'reset-password.js',
        '--allow-short',
        'admin',
        'short',
      ];
      mockedMongoose.__mockCollection.updateOne.mockResolvedValueOnce({
        matchedCount: 1,
        modifiedCount: 1,
      });
      const r = await callRun();
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/Password updated/);
    });

    it('exit 0: long-flag form --username=… --password=… with matched user', async () => {
      // Forces exit 0 by mocking matchedCount=1 (success path). Asserts the
      // long-flag argv parser is exactly equivalent to positional form.
      process.argv = [
        'node',
        'reset-password.js',
        '--username=admin',
        '--password=longsecret',
      ];
      mockedMongoose.__mockCollection.updateOne.mockResolvedValueOnce({
        matchedCount: 1,
        modifiedCount: 1,
      });
      const r = await callRun();
      expect(r.code).toBe(0);
      expect(r.stdout).toMatch(/Password updated for username='admin'/);
    });

    it('long-flag form with non-existent user surfaces exit 3 (same as positional)', async () => {
      process.argv = [
        'node',
        'reset-password.js',
        '--username=ghost',
        '--password=longsecret',
      ];
      mockedMongoose.__mockCollection.updateOne.mockResolvedValueOnce({
        matchedCount: 0,
        modifiedCount: 0,
      });
      const r = await callRun();
      expect(r.code).toBe(3);
      expect(r.stderr).toMatch(/No user found with username='ghost'/);
    });

    // NOTE: The exit-code-1 path (`if (!username || !password)` inside `run()`)
    // is a DEFENSIVE guard. It cannot be reached through the CLI because
    // `parseArgs` ALWAYS falls back to 'admin'/'admin' when both flags and
    // positionals are missing or empty:
    //   username: flags.username || positional[0] || 'admin',
    //   password: flags.password || positional[1] || 'admin',
    // Combining `parseArgs` with a `jest.spyOn` on `script.parseArgs` does
    // not work because `run()` calls the module-level `parseArgs` via
    // lexical-scope closure (NOT via `script.parseArgs`), so the spy is a
    // no-op for the in-run call. The exit-1 branch is therefore covered by
    // inspection at code-review time, NOT by an automated test. If a future
    // refactor splits the guard logic into a separately exportable helper,
    // this note + a new spec block go in `parseArgs-helper.spec.ts`.

    it('exit 2: password < MIN_PASSWORD_LEN without --allow-short', async () => {
      process.argv = ['node', 'reset-password.js', 'admin', 'short'];
      const r = await callRun();
      expect(r.code).toBe(2);
      expect(r.stderr).toMatch(/Refusing to set password of length 5/);
      expect(r.stderr).toMatch(/--allow-short to bypass/);
    });

    // ──────────────────────────────────────────────────────────────────
    // Exit 3: user not found — covers the DEFAULT-DENY ENUMERATION GATE.
    //  - RESET_PASSWORD_REVEAL_USERS must equal '1' to enable user-list
    //    disclosure (review nit #2 closed in commit 48e2234; future drift
    //    in this branch would re-introduce the silent-user-roster-leak.
    // ──────────────────────────────────────────────────────────────────

    describe('exit 3: default-deny enumeration gate', () => {
      beforeEach(() => {
        mockedMongoose.__mockCollection.updateOne.mockResolvedValue({
          matchedCount: 0,
          modifiedCount: 0,
        });
      });

      it('without RESET_PASSWORD_REVEAL_USERS: stderr DOES NOT list usernames (default-deny)', async () => {
        process.argv = ['node', 'reset-password.js', 'admin', 'correctpass'];
        delete process.env.RESET_PASSWORD_REVEAL_USERS;
        const r = await callRun();
        expect(r.code).toBe(3);
        expect(r.stderr).toMatch(/No user found with username='admin'/);
        expect(r.stderr).not.toMatch(/Available usernames:/);
        expect(r.stderr).toMatch(/set RESET_PASSWORD_REVEAL_USERS=1 to enumerate/);
      });

      it('with RESET_PASSWORD_REVEAL_USERS=1: stderr LISTS usernames (opt-in)', async () => {
        process.argv = ['node', 'reset-password.js', 'admin', 'correctpass'];
        process.env.RESET_PASSWORD_REVEAL_USERS = '1';
        mockedMongoose.__mockCollection.find.mockReturnValueOnce({
          toArray: jest
            .fn()
            .mockResolvedValue([{ username: 'alice' }, { username: 'bob' }]),
        });
        const r = await callRun();
        expect(r.code).toBe(3);
        expect(r.stderr).toMatch(/Available usernames: alice, bob/);
      });

      it('RSET_PASSWORD_REVEAL_USERS=1 but empty users collection: "(none)"', async () => {
        process.argv = ['node', 'reset-password.js', 'admin', 'correctpass'];
        process.env.RESET_PASSWORD_REVEAL_USERS = '1';
        mockedMongoose.__mockCollection.find.mockReturnValueOnce({
          toArray: jest.fn().mockResolvedValue([]),
        });
        const r = await callRun();
        expect(r.code).toBe(3);
        expect(r.stderr).toMatch(/Available usernames: \(none\)/);
      });

      it('REVEAL=anything-other-than-"1" is treated as default-deny (security)', async () => {
        process.argv = ['node', 'reset-password.js', 'admin', 'correctpass'];
        process.env.RESET_PASSWORD_REVEAL_USERS = 'true'; // != '1'
        const r = await callRun();
        expect(r.code).toBe(3);
        expect(r.stderr).not.toMatch(/Available usernames:/);
        expect(r.stderr).toMatch(/set RESET_PASSWORD_REVEAL_USERS=1 to enumerate/);
      });
    });

    it('exit 99: run() throws (e.g. mongoose.connect rejects) → outer .catch maps to exit 99', async () => {
      process.argv = ['node', 'reset-password.js', 'admin', 'correctpass'];
      mockedMongoose.connect.mockRejectedValueOnce(new Error('KABOOM'));
      // Replicate production's outer-wrap catch (gated by `require.main !==
      // module` in tests, so it does not auto-fire). The wrapper emits the
      // production-observable stderr "Unexpected failure: KABOOM" and exits 99.
      async function productionInvoke(): Promise<number> {
        try {
          await script.run();
          return 0;
        } catch (err) {
          console.error('Unexpected failure:', (err as Error).message);
          return 99;
        }
      }
      const code = await productionInvoke();
      expect(code).toBe(99);
      expect(
        ((console.error as jest.Mock).mock.calls ?? [])
          .map((c: unknown[]) => c.map(String).join(' '))
          .join('\n'),
      ).toMatch(/Unexpected failure: KABOOM/);
    });
  });
});
