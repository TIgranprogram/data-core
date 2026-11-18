import { visibleSheet } from '../../common/catalog/composition-expand';

export type CompositionPresentation = 'tree' | 'both';
type Input = { status?: unknown; compositionSheet?: unknown; modules?: unknown; compositionPresentation?: unknown };
const text = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

/** Только доказанный простой дубль скрывается при показе; сами данные модулей никогда не удаляются. */
export function compositionPresentation(p: Input): CompositionPresentation {
  if (p.status !== 'draft') return p.compositionPresentation === 'tree' ? 'tree' : 'both';
  const sheet = visibleSheet(p.compositionSheet).filter((r) => r.kind === 'module' || r.word === 'Модуль');
  if (!sheet.length || !Array.isArray(p.modules) || !p.modules.length) return 'both';
  const modules = p.modules as Record<string, unknown>[];
  if (modules.some((m) => !m || !text(m.name) || !(Number(m.qty) > 0) || Object.entries(m).some(([k, v]) => k !== 'name' && k !== 'qty' && v !== undefined && v !== null && v !== ''))) return 'both';
  const key = (name: unknown, qty: unknown) => JSON.stringify([text(name), Number(qty)]);
  const old = modules.map((m) => key(m.name, m.qty)).sort();
  const current = sheet.map((r) => key(r.label, r.qty)).sort();
  return JSON.stringify(old) === JSON.stringify(current) ? 'tree' : 'both';
}
