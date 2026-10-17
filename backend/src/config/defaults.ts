/**
 * Default admin credentials — single source of truth.
 *
 * ## Why this file exists
 *
 * The string literals below were previously duplicated in:
 *   - `backend/src/config/configuration.ts` (env fallback inside the AppConfig factory)
 *   - `backend/src/common/seed/admin-password-drift-detector.ts` (branch-B compare
 *     target to surface "operator forgot to rotate")
 *
 * If those two literals ever drifted, the drift detector's branch B would NEVER
 * fire for the new env value — silent drift would return. Hoisting both literals
 * to this module eliminates that drift risk at the type system level: TypeScript
 * will refuse to compile if either import site is broken.
 *
 * ## DO NOT change these literals casually
 *
 * `DEFAULT_ADMIN_PASSWORD` is the documented dangerous default. It exists as a
 * sentinel so:
 *   - AdminSeed can hash-and-store it on first boot when ADMIN_PASSWORD is unset
 *   - The drift detector can refuse to compare ENV === DEFAULT and instead WARN
 *     that the operator has not rotated away from the demo default.
 *
 * Renaming it requires updating:
 *   - This file (single source)
 *   - Any operator-facing docs that mention the literal (`docs/`, `STACK.md`,
 *     any `README.md` references).
 *   - PR test fixtures that intentionally set the dangerous default to exercise
 *     branch B.
 */

/** Documented dangerous default — admin hash matches this until first rotation. */
export const DEFAULT_ADMIN_PASSWORD =
  'admin-change-me-immediately-in-production';

/** Conventional admin username — kept inline to make seed/config/detector agree. */
export const DEFAULT_ADMIN_USERNAME = 'admin';
