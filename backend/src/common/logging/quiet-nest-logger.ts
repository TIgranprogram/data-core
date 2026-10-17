/**
 * Quiet Nest boot logger (TZ-OPS-301).
 *
 * Drops Nest DI INFO/LOG/DEBUG/VERBOSE from InstanceLoader / RoutesResolver /
 * RouterExplorer / NestFactory. Always passes warn / error / fatal.
 *
 * Escape hatch: NEST_BOOT_VERBOSE=1 or LOG_LEVEL=debug → no filtering.
 */

import type { LoggerService, LogLevel } from '@nestjs/common';

/** Nest contexts that spam one line per module/route during boot. */
export const NEST_DI_NOISE_CONTEXTS = new Set([
  'InstanceLoader',
  'RoutesResolver',
  'RouterExplorer',
  'NestFactory',
]);

export function isNestBootVerbose(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NEST_BOOT_VERBOSE === '1' || env.LOG_LEVEL === 'debug';
}

/** Last string arg is Nest context in typical LoggerService overloads. */
export function extractNestContext(optionalParams: unknown[]): string | undefined {
  for (let i = optionalParams.length - 1; i >= 0; i--) {
    const p = optionalParams[i];
    if (typeof p === 'string' && p.length > 0) return p;
  }
  return undefined;
}

const DROP_LEVELS = new Set<string>(['log', 'debug', 'verbose']);

export function shouldDropNestBootMessage(
  level: string,
  context: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (isNestBootVerbose(env)) return false;
  if (!DROP_LEVELS.has(level)) return false;
  if (!context) return false;
  return NEST_DI_NOISE_CONTEXTS.has(context);
}

/**
 * Wraps an underlying LoggerService (typically nestjs-pino) and filters DI noise.
 * If verbose escape hatch is on, returns the inner logger unchanged.
 */
export function createQuietNestLogger(inner: LoggerService): LoggerService {
  if (isNestBootVerbose()) return inner;
  return new QuietNestLogger(inner);
}

export class QuietNestLogger implements LoggerService {
  constructor(private readonly inner: LoggerService) {}

  log(message: unknown, ...optionalParams: unknown[]): void {
    if (
      shouldDropNestBootMessage('log', extractNestContext(optionalParams))
    ) {
      return;
    }
    this.inner.log?.(message, ...(optionalParams as []));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.inner.error?.(message, ...(optionalParams as []));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.inner.warn?.(message, ...(optionalParams as []));
  }

  debug?(message: unknown, ...optionalParams: unknown[]): void {
    if (
      shouldDropNestBootMessage('debug', extractNestContext(optionalParams))
    ) {
      return;
    }
    this.inner.debug?.(message, ...(optionalParams as []));
  }

  verbose?(message: unknown, ...optionalParams: unknown[]): void {
    if (
      shouldDropNestBootMessage('verbose', extractNestContext(optionalParams))
    ) {
      return;
    }
    this.inner.verbose?.(message, ...(optionalParams as []));
  }

  fatal?(message: unknown, ...optionalParams: unknown[]): void {
    const fatal = this.inner.fatal;
    if (typeof fatal === 'function') {
      fatal.call(this.inner, message, ...(optionalParams as []));
    } else {
      this.inner.error?.(message, ...(optionalParams as []));
    }
  }

  setLogLevels?(levels: LogLevel[]): void {
    this.inner.setLogLevels?.(levels);
  }
}
