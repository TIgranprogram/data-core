#!/usr/bin/env ts-node
/**
 * audit-di.ts — статический анализатор DI cascade багов (TZ-45).
 *
 * Алгоритм:
 *  1. Сканирует все *.module.ts в backend/src/modules/ → строит reverse index
 *     (className → moduleFile, isGlobal).
 *  2. Для каждого *.service.ts парсит constructor → извлекает injected types.
 *  3. Для каждого injected service type проверяет, что consumer module
 *     импортирует provider module (или @Global()).
 *  4. Печатает issues.
 *
 * Запуск: `pnpm exec ts-node scripts/audit-di.ts` (из backend/).
 * Exit code 0 = clean, 1 = issues found.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename, relative, dirname } from 'node:path';

const ROOT = process.cwd();
const MODULES_DIR = join(ROOT, 'src/modules');

function findFiles(dir: string, suffix: string): string[] {
  if (!statSync(dir, { throwIfNoEntry: false })) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findFiles(full, suffix));
    else if (entry.name.endsWith(suffix)) out.push(full);
  }
  return out;
}

function kebabToPascal(s: string): string {
  return s.split('-').map(p => p[0]?.toUpperCase() + p.slice(1)).join('');
}

const moduleFiles = findFiles(MODULES_DIR, '.module.ts');
const serviceFiles = findFiles(MODULES_DIR, '.service.ts');

// 1. Reverse index: className → { moduleFile, isGlobal }
const providerMap = new Map<string, { moduleFile: string; isGlobal: boolean }>();
for (const mf of moduleFiles) {
  const content = readFileSync(mf, 'utf8');
  const isGlobal = /@Global\s*\(/.test(content);
  // Match @Module({ imports: [...], providers: [Foo, Bar, Baz] })
  // Handle multi-line providers array.
  const providersMatch = content.match(/providers\s*:\s*\[([\s\S]*?)\]/);
  if (!providersMatch) continue;
  const providersBody = providersMatch[1];
  // Find PascalCase identifiers (not inside {} objects like {provide, useClass}).
  // Simple heuristic: extract from the whole body, then filter out anything
  // that appears inside { ... } blocks.
  const stripped = providersBody.replace(/\{[^}]*\}/g, '');
  const names = [...stripped.matchAll(/\b([A-Z][A-Za-z0-9]+)\b/g)].map(m => m[1]);
  for (const cls of names) {
    if (cls === 'APP_GUARD' || cls === 'APP_INTERCEPTOR' || cls === 'APP_FILTER'
        || cls === 'APP_PIPE' || cls === 'useFactory' || cls === 'useClass'
        || cls === 'useValue' || cls === 'useExisting') continue;
    if (!providerMap.has(cls)) providerMap.set(cls, { moduleFile: mf, isGlobal });
  }
}

// 2. Build moduleName → filePath map for quick import check.
const moduleNameToFile = new Map<string, string>();
for (const mf of moduleFiles) {
  const moduleName = kebabToPascal(basename(mf, '.module.ts')) + 'Module';
  moduleNameToFile.set(moduleName, mf);
}

// 3. Skip framework/Mongoose/global types.
const skipTypes = new Set([
  'ConfigService', 'Logger', 'Model', 'Connection', 'MongooseModule',
  'InjectModel', 'Inject', 'Optional', 'Injectable', 'Injectable__decorator',
  'PipeTransform', 'CanActivate', 'HttpException', 'BadRequestException',
  'NotFoundException', 'ConflictException', 'UnauthorizedException',
  'ForbiddenException', 'InternalServerErrorException', 'ArgumentMetadata',
  'ExecutionContext', 'CallHandler', 'NestInterceptor', 'ArgumentsHost',
  'ExceptionFilter', 'ValidationPipe', 'HttpAdapterHost', 'Reflector',
  'APP_GUARD', 'APP_INTERCEPTOR', 'APP_FILTER', 'APP_PIPE',
]);

// 4. For each service, parse constructor injections.
const issues: Array<{ consumer: string; consumerFile: string; type: string; providerModule: string; providerFile: string }> = [];

for (const sf of serviceFiles) {
  const content = readFileSync(sf, 'utf8');
  // Match constructor(...) { ... } — works for single/multi-line.
  const ctorMatch = content.match(/constructor\s*\(([\s\S]*?)\)\s*\{/);
  if (!ctorMatch) continue;
  const ctor = ctorMatch[1];
  // Find param types: pattern `name: Type` or `name?: Type` or `...: Type`.
  // We match PascalCase type names that are NOT in skipTypes.
  // Examples:
  //   private readonly foo: FooService
  //   @InjectModel(Foo.name) foo: Model<Foo>
  //   protected bar?: BarService
  // Simple regex: look for `:` then optional whitespace then identifier.
  // Skip lines that have 'InjectModel' or 'Inject(' by removing them first.
  const ctorClean = ctor
    .replace(/@InjectModel\s*\([^)]*\)/g, '')   // strip @InjectModel(Foo.name)
    .replace(/@Inject\s*\(\s*['"`][^'"`]*['"`]\s*\)/g, '') // strip @Inject('TOKEN')
    .replace(/@\w+\s*/g, '');                    // strip other decorators
  const paramTypes = [...ctorClean.matchAll(/[:=]\s*([A-Z][A-Za-z0-9]+)/g)]
    .map(m => m[1])
    .filter(t => !skipTypes.has(t));

  const consumerFile = sf;
  const consumerName = kebabToPascal(basename(sf, '.service.ts')) + 'Service';
  const consumerModuleFile = sf.replace(/\.service\.ts$/, '.module.ts');
  if (!statSync(consumerModuleFile, { throwIfNoEntry: false })) continue;
  const consumerContent = readFileSync(consumerModuleFile, 'utf8');

  for (const type of new Set(paramTypes)) {
    const provider = providerMap.get(type);
    if (!provider) continue; // не наш сервис (или external)
    if (provider.isGlobal) continue; // @Global() — доступен везде
    if (type === consumerName) continue; // self-injection (singleton self) — ОК

    // provider.moduleFile → module class name.
    const providerModuleName = kebabToPascal(basename(provider.moduleFile, '.module.ts')) + 'Module';
    // Self-import OK (module can re-import itself, but we skip — not relevant).
    if (provider.moduleFile === consumerModuleFile) continue;

    // Check consumer imports provider module.
    // Look in @Module({imports: [...]}) AND in `imports: [...]` at top of class.
    const importsMatch = consumerContent.match(/imports\s*:\s*\[([\s\S]*?)\]/);
    if (importsMatch && importsMatch[1].includes(providerModuleName)) continue;

    // Some modules use `forwardRef(() => X)` — also acceptable.
    if (importsMatch && /forwardRef/.test(importsMatch[1])) continue;

    issues.push({
      consumer: kebabToPascal(basename(consumerModuleFile, '.module.ts')) + 'Module',
      consumerFile: relative(ROOT, consumerFile),
      type,
      providerModule: providerModuleName,
      providerFile: relative(ROOT, provider.moduleFile),
    });
  }
}

// 5. Output.
if (issues.length === 0) {
  console.log('\u2714 No DI issues found (audit clean)');
  process.exit(0);
} else {
  console.log(`\u2716 ${issues.length} DI issue(s) found:\n`);
  // Group by consumer for readability.
  const byConsumer = new Map<string, typeof issues>();
  for (const i of issues) {
    if (!byConsumer.has(i.consumer)) byConsumer.set(i.consumer, []);
    byConsumer.get(i.consumer)!.push(i);
  }
  for (const [consumer, list] of byConsumer) {
    console.log(`  ${consumer}:`);
    for (const i of list) {
      console.log(`    \u2192 injects ${i.type} (in ${i.providerModule} = ${i.providerFile})`);
      console.log(`      Fix: add ${i.providerModule} to imports: [] in ${i.consumerFile.replace(/\.service\.ts$/, '.module.ts')}`);
    }
    console.log('');
  }
  process.exit(1);
}
