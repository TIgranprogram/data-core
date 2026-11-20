/** TZ-CORE-302: коллекции обязаны иметь deletedAt либо явный softDelete:false. */
import { readdirSync, readFileSync } from 'fs';
import { dirname, join, normalize, relative } from 'path';
import * as ts from 'typescript';

const BACKEND_SRC = join(__dirname, '..');
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory()
    ? sourceFiles(join(dir, e.name)) : e.name.endsWith('.ts') && !e.name.endsWith('.spec.ts') ? [join(dir, e.name)] : []);
}

/** Инвентаризация фактических регистраций; alias/re-export разрешаются без typechecker. */
function registeredSchemaFiles(repo: Map<string, string>): Set<string> {
  const parsed = new Map<string, ts.SourceFile>();
  const source = (file: string) => {
    if (!parsed.has(file)) parsed.set(file, ts.createSourceFile(file, repo.get(file) ?? '', ts.ScriptTarget.Latest, true));
    return parsed.get(file)!;
  };
  const target = (file: string, spec: string) => {
    if (!spec.startsWith('.')) return undefined;
    const base = normalize(join(dirname(file), spec));
    return [base, base + '.ts', join(base, 'index.ts')].find(p => repo.has(p));
  };
  const origin = (file: string, name: string, seen = new Set<string>()): string | undefined => {
    const key = file + '#' + name;
    if (seen.has(key)) return undefined;
    seen.add(key);
    for (const stmt of source(file).statements) {
      if (ts.isVariableStatement(stmt)) {
        const d = stmt.declarationList.declarations.find(d => ts.isIdentifier(d.name) && d.name.text === name);
        if (d) return d.initializer && ts.isIdentifier(d.initializer) ? origin(file, d.initializer.text, seen) : file;
      }
      if ((ts.isClassDeclaration(stmt) || ts.isFunctionDeclaration(stmt)) && stmt.name?.text === name) return file;
      if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const bindings = stmt.importClause?.namedBindings;
        const binding = bindings && ts.isNamedImports(bindings) ? bindings.elements.find(e => e.name.text === name) : undefined;
        const to = target(file, stmt.moduleSpecifier.text);
        if (binding && to) return origin(to, binding.propertyName?.text ?? binding.name.text, seen);
        if (stmt.importClause?.name?.text === name && to) return origin(to, 'default', seen);
      }
      if (ts.isExportAssignment(stmt) && name === 'default' && ts.isIdentifier(stmt.expression)) return origin(file, stmt.expression.text, seen);
      if (ts.isExportDeclaration(stmt) && !stmt.moduleSpecifier && stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
        const b = stmt.exportClause.elements.find(e => e.name.text === name);
        if (b) return origin(file, b.propertyName?.text ?? b.name.text, seen);
      }
      if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const to = target(file, stmt.moduleSpecifier.text);
        if (!to) continue;
        if (!stmt.exportClause) { const found = origin(to, name, new Set(seen)); if (found) return found; }
        else if (ts.isNamedExports(stmt.exportClause)) {
          const binding = stmt.exportClause.elements.find(e => e.name.text === name);
          if (binding) return origin(to, binding.propertyName?.text ?? binding.name.text, seen);
        }
      }
    }
    return undefined;
  };
  const registered = new Set<string>();
  for (const file of repo.keys()) {
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) {
        const called = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text : node.expression.getText(source(file));
        if (['forFeature', 'forFeatureAsync', 'model', 'discriminator'].includes(called)) {
          const inspect = (argument: ts.Node) => {
            if (ts.isIdentifier(argument)) { const from = origin(file, argument.text); if (from) registered.add(from); }
            if (ts.isPropertyAccessExpression(argument) && ts.isIdentifier(argument.expression)) {
              for (const stmt of source(file).statements) {
                if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
                const binding = stmt.importClause?.namedBindings;
                const to = target(file, stmt.moduleSpecifier.text);
                if (to && binding && ts.isNamespaceImport(binding) && binding.name.text === argument.expression.text) {
                  const from = origin(to, argument.name.text); if (from) registered.add(from);
                }
              }
            }
            if (ts.isNewExpression(argument)) registered.add(file);
            ts.forEachChild(argument, inspect);
          };
          node.arguments.forEach(inspect);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source(file));
  }
  return registered;
}

function rawEmbedded(content: string, registered: boolean): boolean {
  if (registered) return false;
  const source = ts.createSourceFile('candidate.ts', content, ts.ScriptTarget.Latest, true);
  const constructors: ts.NewExpression[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isNewExpression(node) && /(?:^|\.)Schema$/.test(node.expression.getText(source))) constructors.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return constructors.length > 0 && constructors.every(node => {
    const options = node.arguments?.[1];
    if (!options || !ts.isObjectLiteralExpression(options)) return false;
    if (options.properties.some(p => !ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name) && !ts.isStringLiteral(p.name))) return false;
    const fields = options.properties.filter(ts.isPropertyAssignment);
    return fields.some(p => p.name.getText(source) === '_id' && p.initializer.kind === ts.SyntaxKind.FalseKeyword)
      && !fields.some(p => p.name.getText(source).replace(/['"]/g, '') === 'collection');
  });
}

describe('soft-delete coverage (TZ-CORE-302)', () => {
  it('every collection schema has deletedAt or softDelete: false', () => {
    const repo = new Map(sourceFiles(BACKEND_SRC).map(file => [normalize(file), readFileSync(file, 'utf8')]));
    const registered = registeredSchemaFiles(repo), violations: string[] = [];
    for (const [file, content] of repo) {
      if (!file.endsWith('.schema.ts')) continue;
      const nestedDecorator = content.includes('@Schema({ _id: false })') && !content.includes('collection:');
      if (!registered.has(file) && (nestedDecorator || rawEmbedded(content, false))) continue;
      if (!content.includes('deletedAt') && !content.includes('softDelete: false')) violations.push(relative(BACKEND_SRC, file));
    }
    expect(violations).toEqual([]);
  });
  const file = normalize('/fixtures/part.schema.ts');
  const embedded = 'import { Schema } from "mongoose"; export const PartSchema = new Schema({ value: String }, { _id: false, strict: true });';
  it('не требует soft-delete у raw embedded без коллекции', () => { expect(rawEmbedded(embedded, false)).toBe(true); });
  it('не исключает raw schema с собственным _id', () => { expect(rawEmbedded(embedded.replace('_id: false', '_id: true'), false)).toBe(false); });
  it('не исключает явную collection даже с _id:false', () => { expect(rawEmbedded(embedded.replace('strict: true', 'collection: "parts"'), false)).toBe(false); });
  it('не исключает неизвестные spread options', () => { expect(rawEmbedded(embedded.replace('strict: true', '...options'), false)).toBe(false); });
  it.each([false, true])('не исключает зарегистрированную schema через import alias / barrel=%s', barrel => {
    const repo = new Map([[file, embedded], [normalize('/fixtures/parts.module.ts'),
      `import { PartSchema as Renamed } from './${barrel ? 'barrel' : 'part.schema'}'; MongooseModule.forFeature([{ name: 'Part', schema: Renamed }]);`]]);
    if (barrel) repo.set(normalize('/fixtures/barrel.ts'), 'export { PartSchema } from "./part.schema";');
    const registered = registeredSchemaFiles(repo);
    expect(registered.has(file)).toBe(true);
    expect(rawEmbedded(embedded, registered.has(file))).toBe(false);
  });
  it('не исключает регистрацию через namespace import', () => {
    const repo = new Map([[file, embedded], [normalize('/fixtures/parts.module.ts'), 'import * as parts from "./part.schema"; MongooseModule.forFeature([{ name: "Part", schema: parts.PartSchema }]);']]);
    expect(registeredSchemaFiles(repo).has(file)).toBe(true);
  });
});
