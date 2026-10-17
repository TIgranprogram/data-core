import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../../modules/user/user.service';
import {
  DEFAULT_ADMIN_PASSWORD,
  DEFAULT_ADMIN_USERNAME,
} from '../../config/defaults';

/**
 * Surface silent drift between ADMIN_PASSWORD env value and the bcrypt hash
 * actually stored on disk for the admin user.
 *
 * ## Why this hook exists
 *
 * `LoginService` reads `passwordHash` from MongoDB via `UserService.verifyPassword`
 * — it does NOT read `ADMIN_PASSWORD` from env at login time. The env var is a
 * "ghost config": jest e2e helpers (`reset-password.js`) compare against it,
 * and the AdminSeed service uses it for the first-time-admin upsert path, but
 * nothing in normal request flow consults it.
 *
 * Result: an operator who rotates `ADMIN_PASSWORD` in `.env` after the first
 * boot sees zero behaviour change. The DB hash still wins. Months can pass
 * before anyone notices their rotation never went live. (Optionally surfaced
 * much sooner today by `reset-password.js` run after env rotation — but only
 * if the operator remembers to run it.)
 *
 * This hook makes the drift noisy at every boot instead of silent. It is the
 * "early-warning system" the operator asked for in the hook task brief:
 *
 *   > "Add an onApplicationBootstrap hook that warns when ADMIN_PASSWORD
 *   >  env value differs from a hash on disk — surface the silent drift
 *   >  the next time instead of letting it leak for months"
 *
 * ## Lifecycle ordering
 *
 * NestJS dispatches `OnApplicationBootstrap` hooks in the order the providers
 * are declared in the module's `providers` array. This class is registered
 * AFTER `AdminSeed` (see `backend/src/app.module.ts`), so we read the hash
 * state *after* any first-time seeding has completed — never mid-seed.
 *
 * ## Severity policy
 *
 * All branches log at `warn` level. This is an operator-facing hint, not a
 * hard failure: the login flow continues to function on the existing DB hash.
 * The WARN is the signal that the operator's env↔DB invariant is broken.
 *
 * ## Skip conditions (default-deny)
 *
 * The hook runs UNLESS one of these opt-outs is explicitly true:
 *  - `NODE_ENV === 'test'` — jest e2e suites intentionally desync env↔DB
 *    (`test/setup/test-db.ts`); warning would noise CI logs without new signal.
 *  - `process.env.DISABLE_PASSWORD_DRIFT_CHECK === '1'` — sandbox/dev escape
 *    hatch for operators who know they want a desync and don't want the noise.
 *
 * Both opt-outs are explicit-string equality. Empty / unset = hook enabled.
 */
@Injectable()
export class AdminPasswordDriftDetector implements OnApplicationBootstrap {
  private readonly logger = new Logger(AdminPasswordDriftDetector.name);

  constructor(
    private readonly users: UserService,
    private readonly config: ConfigService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // ----- opt-outs first (default-deny enumeration) -----
    const nodeEnv = this.config.get<string>('nodeEnv');
    if (nodeEnv?.toLowerCase() === 'test') return;
    if (process.env.DISABLE_PASSWORD_DRIFT_CHECK === '1') return;

    const username: string =
      this.config.get<string>('admin.username') ?? DEFAULT_ADMIN_USERNAME;
    const envPassword: string =
      this.config.get<string>('admin.password') ?? '';

    // ----- branch A: empty env -----
    // Even if bcrypt.compare somehow matched (it won't — an empty plaintext
    // cannot match a real bcrypt hash), an unset ADMIN_PASSWORD in production
    // is never a sane configuration and must be surfaced.
    if (envPassword.length === 0) {
      this.logger.warn(
        `ADMIN_PASSWORD env is empty. Admin user "${username}" is logged in ` +
          `via the bcrypt hash on disk; the env var is ignored at login. ` +
          `Set ADMIN_PASSWORD=… in .env or run: cd backend && ` +
          `pnpm user:set-password --username=${username} ` +
          `--password="<your-password>"`,
      );
      return;
    }

    // ----- branch B: dangerous-equal-default -----
    // The documented dangerous default — admin was seeded with the same
    // literal at first boot, so bcrypt.compare would always match. We refuse
    // the comparison and warn explicitly so the operator knows they have not
    // rotated away from the demo default before promoting to production.
    if (envPassword === DEFAULT_ADMIN_PASSWORD) {
      this.logger.warn(
        `ADMIN_PASSWORD env matches the documented dangerous default ` +
          `("${DEFAULT_ADMIN_PASSWORD}"). Operator must ` +
          `rotate before promoting this env to production. To rotate: ` +
          `cd backend && pnpm user:set-password --username=${username} ` +
          `--password="<strong-password>"`,
      );
      return;
    }

    // ----- branch C: admin user missing -----
    // AdminSeed should have created this user in the users.count() === 0 path.
    // If findByUsername still returns null after AdminSeed's bootstrap, the
    // boot order is broken (admin was deleted between seeds? wrong username?).
    const user = await this.users.findByUsername(username);
    if (!user) {
      this.logger.warn(
        `Admin user "${username}" not found after AdminSeed. Drift ` +
          `check skipped — the operator likely needs to create this user: ` +
          `cd backend && pnpm user:set-password --username=${username} ` +
          `--password="<your-password>"`,
      );
      return;
    }

    // ----- branch D: soft-disabled admin -----
    // isActive === false means the operator has explicitly disabled this
    // account. Drift is irrelevant — the user is not in the live auth flow.
    if (user.isActive === false) return;

    // ----- branch E: actual drift -----
    // verifyPassword wraps bcrypt.compare(hash, plaintext); true = env matches
    // the stored hash. Wrap in try/catch because if passwordHash were ever
    // masked by a future schema change (`.select(false)`), bcrypt.compare
    // would throw on undefined — we should NOT halt boot for a hint.
    let matches: boolean;
    try {
      matches = await this.users.verifyPassword(user, envPassword);
    } catch (err) {
      this.logger.warn(
        `Unable to read admin passwordHash from DB; drift check skipped ` +
          `(reason: ${(err as Error).message}). If passwordHash was masked ` +
          `by a future schema change, expose it for this hook via ` +
          `UserService.findByUsername's projection.`,
      );
      return;
    }

    if (!matches) {
      this.logger.warn(
        `ADMIN_PASSWORD env does NOT match the bcrypt hash stored for ` +
          `admin user "${username}". Login reads FROM DATABASE, not env — ` +
          `the recent env rotation went unnoticed. To sync DB to env: ` +
          `cd backend && pnpm user:set-password --username=${username} ` +
          `--password="$ADMIN_PASSWORD"`,
      );
      return;
    }

    // Match — silent on the happy path. Do not log noise.
  }
}
