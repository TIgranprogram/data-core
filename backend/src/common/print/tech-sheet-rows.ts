import type { MaterialsSpec } from '../catalog/materials-text';

/** Справочная подпись (id записи → название). Материалы и покрытия — один словарь. */
export type TechName = { id: string; name: string };

export interface TechRowsInput {
  spec?: MaterialsSpec | null;
  mats: TechName[];
  parts: TechName[];
  length?: number;
  width?: number;
  height?: number;
  /** Единица габаритов. Пусто — мм. */
  unit?: string;
  weight?: number;
  purpose?: string;
  installation?: string;
}

const round10 = (n: number) => Math.round(n / 10) * 10;
const range = (a: number, b: number, unit: string) => `не менее ${String(a).replace('.', ',')} и не более ${String(b).replace('.', ',')} ${unit}`;

/** Толщина стенки из размера: «∅89×3» → 3, «120×60×3» → 3; лист — само число. Как в окне техописания. */
export function wallOf(size: string): number | null {
  const parts = String(size || '').replace(/^∅/, '').split('×');
  const round = String(size || '').startsWith('∅');
  const raw = round ? parts[1] : parts.length === 3 ? parts[2] : parts.length === 1 ? parts[0] : null;
  const n = Number(String(raw ?? '').replace(',', '.'));
  return n > 0 ? n : null;
}

/**
 * Строки технического описания из состава изделия (`materialsSpec`) и габаритов.
 * Те же допуски, что окно в приложении: стенка ±1 мм (если толще 1 мм), габариты ±10 %.
 * Пустой состав и пустые габариты — пустой список (вызывающий решает, что сказать).
 */
export function techSheetRows(i: TechRowsInput): { name: string; text: string }[] {
  const matBy = new Map(i.mats.map((m) => [String(m.id), String(m.name || '').trim()]));
  const partBy = new Map(i.parts.map((p) => [String(p.id), String(p.name || '').trim()]));
  const rows: { name: string; text: string }[] = [];
  for (const row of i.spec?.rows ?? []) {
    const mat = matBy.get(String(row.materialId)) || '';
    const sizes = (row.sizes || []).filter(Boolean).join(', ');
    const wall = wallOf(row.sizes?.[0] || '');
    const tol = wall && wall > 1 ? `, толщина ${range(wall - 1, wall + 1, 'мм')}` : '';
    const name = (row.partIds || []).map((id) => partBy.get(String(id))).filter(Boolean).join(', ') || 'Материал';
    const text = String(row.techText || '').trim() || [mat, sizes].filter(Boolean).join(' ') + tol;
    if (name || text) rows.push({ name, text });
  }
  const coats = (i.spec?.coatingIds ?? []).flatMap((id) => {
    const texts = (i.spec?.coatingTexts ?? []).filter((c) => String(c.materialId) === String(id)).map((c) => String(c.techText || '').trim()).filter(Boolean);
    return texts.length ? [...new Set(texts)] : [matBy.get(String(id))];
  }).filter(Boolean);
  if (coats.length) rows.push({ name: 'Покрытие', text: coats.join(', ') });
  const unit = String(i.unit || 'мм').trim() || 'мм';
  for (const [k, label] of [['length', 'Длина'], ['width', 'Ширина'], ['height', 'Высота']] as const) {
    const n = Number(i[k]);
    if (n > 0) rows.push({ name: label, text: range(round10(n * 0.9), round10(n * 1.1), unit) });
  }
  if (Number(i.weight) > 0) rows.push({ name: 'Вес', text: `${String(i.weight).replace('.', ',')} кг` });
  const purpose = String(i.purpose ?? '').trim();
  const installation = String(i.installation ?? '').trim();
  if (purpose) rows.push({ name: 'Назначение', text: purpose });
  if (installation) rows.push({ name: 'Установка', text: installation });
  return rows;
}
