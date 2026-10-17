import { shouldDropNestBootMessage, isNestBootVerbose } from './quiet-nest-logger';

describe('quiet-nest-logger (TZ-OPS-301)', () => {
  const quietEnv = { LOG_LEVEL: 'info', NEST_BOOT_VERBOSE: undefined } as NodeJS.ProcessEnv;

  it('drops InstanceLoader log in quiet mode', () => {
    expect(shouldDropNestBootMessage('log', 'InstanceLoader', quietEnv)).toBe(true);
    expect(shouldDropNestBootMessage('log', 'RoutesResolver', quietEnv)).toBe(true);
    expect(shouldDropNestBootMessage('log', 'RouterExplorer', quietEnv)).toBe(true);
    expect(shouldDropNestBootMessage('log', 'NestFactory', quietEnv)).toBe(true);
  });

  it('never drops warn/error', () => {
    expect(shouldDropNestBootMessage('warn', 'InstanceLoader', quietEnv)).toBe(false);
    expect(shouldDropNestBootMessage('error', 'NestFactory', quietEnv)).toBe(false);
  });

  it('keeps Bootstrap and other contexts', () => {
    expect(shouldDropNestBootMessage('log', 'Bootstrap', quietEnv)).toBe(false);
    expect(shouldDropNestBootMessage('log', 'SecretValidation', quietEnv)).toBe(false);
  });

  it('NEST_BOOT_VERBOSE=1 disables filter', () => {
    const env = { ...quietEnv, NEST_BOOT_VERBOSE: '1' };
    expect(isNestBootVerbose(env)).toBe(true);
    expect(shouldDropNestBootMessage('log', 'InstanceLoader', env)).toBe(false);
  });

  it('LOG_LEVEL=debug disables filter', () => {
    const env = { LOG_LEVEL: 'debug' } as NodeJS.ProcessEnv;
    expect(isNestBootVerbose(env)).toBe(true);
    expect(shouldDropNestBootMessage('log', 'InstanceLoader', env)).toBe(false);
  });
});
