/**
 * TZ-86 F.3 follow-up — `reset-password.js` CLI for kppdf-8.0.
 *
 * Usage:
 *   node backend/reset-password.js                                       # default: admin / admin
 *   node backend/reset-password.js <username>                            # default password 'admin'
 *   node backend/reset-password.js <username> <password>                 # explicit user+pass
 *   node backend/reset-password.js --allow-short admin short             # bypass 8-char min
 *   node backend/reset-password.js --help                                # usage
 *   pnpm user:set-password -- --username=foo --password=bar             # npm convenience
 *
 * Why this exists: `admin.seed.ts` only runs the bcrypt-hash upsert when the
 * users collection is empty. After the first boot, changing ADMIN_PASSWORD
 * in any `.env` does NOT propagate to existing users (silent inconsistency).
 * This script is the canonical manual reset path.
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

/** Min password length unless `--allow-short` is set (dev/test affordance). */
const MIN_PASSWORD_LEN = 8;
/** Flags whose presence means `true` (they consume their own word, not the next). */
const BOOLEAN_FLAGS = new Set(['allow-short']);
const FALLBACK_MONGO_URI = 'mongodb://localhost:27017/kppdf';

/**
 * Inject `?directConnection=true` into a Mongo URI if missing — same
 * defense-in-depth pattern as start.mjs `ensureDirectConnection`. Per TZ-46
 * hotfix v3 docker-compose re-inits the rs with member host `127.0.0.1:27017`
 * so this is mostly a no-op in the current setup; but if anyone runs the
 * script against a non-localhost replica set (CI, dev box that talks to
 * the rs via `mongo:27017` member) this lets the driver SKIP topology
 * discovery and use the seed host only — avoiding the ENOTFOUND cycle.
 */
function ensureDirectConnection(uri) {
  if (!uri) return uri;
  if (/[?&]directConnection=/i.test(uri)) return uri;
  const sep = uri.includes('?') ? '&' : '?';
  return uri + sep + 'directConnection=true';
}

/**
 * Parse argv into { username, password, allowShort, help }. Handles:
 *  - positional:  node reset-password.js <user> <pass>
 *  - long flags:  node reset-password.js --username=foo --password=bar
 *  - boolean:     node reset-password.js --allow-short admin short
 *    (`--allow-short` consumes its own word; the next word starts the
 *     positional arg list again.)
 */
function parseArgs(argv) {
  // argv[0] = node, argv[1] = script; skip both.
  const args = argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    return { help: true };
  }
  const positional = [];
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const eqIdx = a.indexOf('=');
    const key = eqIdx >= 0 ? a.slice(2, eqIdx) : a.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      flags[key] = true;
      // do NOT consume next arg; it starts a new positional.
      continue;
    }
    const value = eqIdx >= 0 ? a.slice(eqIdx + 1) : args[i + 1] ?? '';
    flags[key] = value;
    if (eqIdx < 0) i++;
  }
  return {
    username: flags.username || positional[0] || 'admin',
    password: flags.password || positional[1] || 'admin',
    allowShort: !!flags['allow-short'],
  };
}

function printHelp() {
  const lines = [
    'Usage: node backend/reset-password.js [<user> [<pass>]]',
    '       pnpm user:set-password -- --username=<u> --password=<p>',
    '',
    `Defaults: username=admin, password=admin (pre-F.3 back-compat).`,
    `Min password length: ${MIN_PASSWORD_LEN} chars (--allow-short to bypass).`,
    '',
    'Examples:',
    '  node backend/reset-password.js',
    '  node backend/reset-password.js admin "Admin#2026"',
    '  pnpm user:set-password -- --username=alice --password=secret123',
    '  node backend/reset-password.js --allow-short admin short',
    '',
    'Env: process.env.MONGO_URI overrides the default URI; directConnection=true',
    `is auto-injected if absent. Fallback URI: ${FALLBACK_MONGO_URI}.`,
    '',
    'Username-list enumeration on "user not found" is OPT-IN:',
    'set RESET_PASSWORD_REVEAL_USERS=1 (dev/test) to print all usernames;',
    'in any other env (including no NODE_ENV), the script prints only the',
    'requested username + "no such user" so a typo does not leak the user roster.',
  ];
  console.log(lines.join('\n'));
}

async function run() {
  const parsed = parseArgs(process.argv);
  if (parsed.help) {
    printHelp();
    return;
  }
  const { username, password, allowShort } = parsed;
  if (!username || !password) {
    console.error('Error: username and password are required.');
    printHelp();
    process.exit(1);
  }
  if (password.length < MIN_PASSWORD_LEN && !allowShort) {
    console.error(
      `Refusing to set password of length ${password.length}; minimum ` +
        `${MIN_PASSWORD_LEN} chars. Pass --allow-short to bypass (dev/test only).`,
    );
    process.exit(2);
  }
  const rawUri = process.env.MONGO_URI || FALLBACK_MONGO_URI;
  const uri = ensureDirectConnection(rawUri);
  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    const hash = await bcrypt.hash(password, 10);
    const collection = db.collection('users');
    const result = await collection.updateOne(
      { username },
      { $set: { passwordHash: hash } },
    );
    if (result.matchedCount === 0) {
      // Default-deny enumeration: ONLY print the user list when the operator
      // has explicitly opted in via RESET_PASSWORD_REVEAL_USERS=1. Prevents
      // a typo from leaking the full user roster in any env (including mis-
      // configured "no NODE_ENV set" production deployments). — review nit.
      const revealUsers = process.env.RESET_PASSWORD_REVEAL_USERS === '1';
      if (revealUsers) {
        const available = (
          await collection
            .find({}, { projection: { username: 1 } })
            .toArray()
        )
          .map((u) => u.username)
          .join(', ') || '(none)';
        console.error(
          `No user found with username='${username}'. Password NOT changed. ` +
            `Available usernames: ${available}`,
        );
      } else {
        console.error(
          `No user found with username='${username}'. Password NOT changed. ` +
            '(set RESET_PASSWORD_REVEAL_USERS=1 to enumerate available usernames)',
        );
      }
      process.exit(3);
    }
    console.log(
      `Password updated for username='${username}' ` +
        `(matchedCount=${result.matchedCount}, modifiedCount=${result.modifiedCount}).`,
    );
  } finally {
    await mongoose.disconnect();
  }
}

// Top-level invocation only when this file is the entry point. Gated by
// `require.main === module` so jest specs can `require()` the script for
// unit testing without triggering the startup-and-exit side effects.
if (require.main === module) {
  run().catch((err) => {
    console.error('Unexpected failure:', err.message);
    process.exit(99);
  });
}

module.exports = {
  parseArgs,
  run,
  ensureDirectConnection,
  printHelp,
  MIN_PASSWORD_LEN,
  BOOLEAN_FLAGS,
  FALLBACK_MONGO_URI,
};
