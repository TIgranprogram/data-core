/**
 * Материалы изделия таблицей (Фаза МИ, docs/TASKS.md): строки «материал · размеры · из чего (части)» + покрытия →
 * текст «Изготовлено из … Состоит из … <фраза покрытия>». Чистые функции без базы: сборка текста (МИ.3),
 * нормализация размера, разбор «Состава изделия» в строки («Взять из состава», МИ.2). Справочники — `dict_values`:
 * `passportMaterials` (kind material|coating, genSingular, genPlural, sizeTemplate с {sizes}, phrase, madeOf),
 * `passportParts` (genSingular, genPlural), `passportSortament` (name — размер без «мм», material — код материала).
 */
export type ManualTexts = { passportText?: string; techText?: string };
export type CoatingText = ManualTexts & { materialId: string };
export type SpecRow = ManualTexts & { materialId: string; sizes: string[]; partIds: string[] };
export type MaterialsSpec = { rows: SpecRow[]; coatingIds: string[]; coatingTexts?: CoatingText[] };
export type MatRec = { name?: unknown; code?: unknown; kind?: unknown; genSingular?: unknown; genPlural?: unknown; madeOf?: unknown; sizeTemplate?: unknown; phrase?: unknown };
export type PartRec = { name?: unknown; genSingular?: unknown; genPlural?: unknown };

const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const low = (v: unknown) => s(v).toLowerCase().replace(/ё/g, 'е');

/** Размер одним написанием: «Ø 33.5 x 2,8 мм» → «∅33,5×2,8»; «2 мм» → «2». Единица — в шаблоне материала. */
export function normSize(v: unknown): string {
  return s(v)
    .replace(/\s*мм\.?$/i, '')
    .replace(/^[∅Ø⌀ø]\s*/, '∅')
    .replace(/(\d)\s*[xхXХ*×]\s*(?=\d)/g, '$1×')
    .replace(/(\d)\.(?=\d)/g, '$1,');
}

/** Перечень по-русски: «a», «a и b», «a, b и c». */
export function joinRu(list: string[]): string {
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} и ${list[list.length - 1]}`;
}

const sentence = (t: string) => { const x = s(t); return !x ? '' : /[.!?]$/.test(x) ? x : x + '.'; };

/**
 * Сборка текста (МИ.3). Строки одного материала объединяются (размеры без дублей, в порядке ввода); форма — род. п.
 * ед. ч. при 0–1 размере, мн. ч. при двух и больше; размеры — по шаблону записи (`{sizes}`; пусто — «{sizes} мм»);
 * строка без размеров — без пустых «∅×» / «толщиной мм» (ТЭ-4). Части — одним перечнем без дублей (род. п. мн. ч.).
 * Покрытия — их фразы. Неизвестные id (запись удалена из справочника) пропускаются. Пустая таблица — ''.
 */
export function composeMaterialsText(spec: MaterialsSpec | null | undefined, mats: Map<string, MatRec>, parts: Map<string, PartRec>): string {
  if (!spec) return '';
  const byMat = new Map<string, string[]>();
  const partIds: string[] = [];
  const manual: string[] = [];
  for (const r of spec.rows ?? []) {
    for (const p of r.partIds ?? []) if (parts.has(p) && !partIds.includes(p)) partIds.push(p);
    if (s(r.passportText)) { if (!manual.includes(s(r.passportText))) manual.push(s(r.passportText)); continue; }
    if (!mats.has(r.materialId)) continue;
    const list = byMat.get(r.materialId) ?? [];
    for (const z of (r.sizes ?? []).map(normSize).filter(Boolean)) if (!list.includes(z)) list.push(z);
    byMat.set(r.materialId, list);
  }
  const made = [...byMat].map(([id, sizes]) => {
    const m = mats.get(id)!;
    // «толщиной 2 и 6 мм» — несколько толщин одного листа: ед. число («стального листа»); сечения («∅89×3 и ∅33,5×2,8») — мн. («стальных труб»)
    const many = sizes.length > 1 && !/^\s*толщин/i.test(s(m.sizeTemplate));
    const gen = (many ? s(m.genPlural) || s(m.genSingular) : s(m.genSingular) || s(m.genPlural)) || s(m.madeOf) || low(m.name);
    if (!sizes.length) return gen;
    const tpl = s(m.sizeTemplate) || '{sizes} мм';
    return `${gen} ${tpl.includes('{sizes}') ? tpl.replace('{sizes}', joinRu(sizes)) : `${joinRu(sizes)} ${tpl}`}`;
  }).filter(Boolean);
  const partNames = [...new Set(partIds.map((id) => { const p = parts.get(id)!; return s(p.genPlural) || s(p.genSingular) || low(p.name); }).filter(Boolean))];
  const coats = [...new Set((spec.coatingIds ?? []).flatMap((id) => {
    const texts = (spec.coatingTexts ?? []).filter((c) => c.materialId === id).map((c) => s(c.passportText)).filter(Boolean);
    if (texts.length) return texts.map((t) => sentence(`Покрытие: ${t}`));
    const c = mats.get(id);
    return c ? [sentence(s(c.phrase) || (s(c.name) ? `Покрытие: ${low(c.name)}` : ''))] : [];
  }).filter(Boolean))];
  return [
    made.length ? `Изготовлено из ${made.join(', ')}.` : '',
    ...manual.map((t) => sentence(`Материалы: ${t}`)),
    partNames.length ? `Состоит из ${joinRu(partNames)}.` : '',
    ...coats,
  ].filter(Boolean).join(' ');
}

/** Основы слов (первые 5 букв) — сравнение названий склада и справочника без окончаний. */
const stems = (v: unknown) => low(v).replace(/[()«»"',.]/g, ' ').split(/[\s/-]+/).filter((w) => w.length >= 3 && !/^\d/.test(w)).map((w) => w.slice(0, 5));
const nums = (t: string) => (t.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => x.replace('.', ','));

/**
 * Запись справочника для позиции склада: первое слово названия записи обязательно есть в названии позиции, больше
 * совпавших слов — лучше, при равенстве — короче название («Труба 89×3» → «Труба стальная», «Труба профильная 40×40×2» →
 * «Труба стальная профильная»). Нет подходящей — null.
 */
export function matchMaterial<T extends MatRec>(text: string, recs: T[]): T | null {
  const have = new Set(stems(text));
  let best: { r: T; score: number; len: number } | null = null;
  for (const r of recs) {
    const st = stems(r.name);
    if (!st.length || !have.has(st[0])) continue;
    const score = st.filter((x) => have.has(x)).length;
    if (!best || score > best.score || (score === best.score && st.length < best.len)) best = { r, score, len: st.length };
  }
  return best?.r ?? null;
}

/** Размер из названия позиции склада под шаблон материала: толщина листа, ∅d×s трубы, a×b×c профиля. '' — не нашли. */
export function sizeFromStock(text: string, rec: MatRec): string {
  const t = s(text).replace(/(\d)\s*[xхXХ*×]\s*(?=\d)/g, '$1×');
  const tpl = low(rec.sizeTemplate);
  const triple = t.match(/(\d+(?:[.,]\d+)?)×(\d+(?:[.,]\d+)?)×(\d+(?:[.,]\d+)?)/);
  const pair = t.match(/(\d+(?:[.,]\d+)?)×(\d+(?:[.,]\d+)?)/);
  const dia = t.match(/[∅Ø⌀ø]\s*(\d+(?:[.,]\d+)?)(?:×(\d+(?:[.,]\d+)?))?/);
  if (tpl.includes('толщин')) {
    // лист: «Лист 2 мм», «Лист г/к 2×1250×2500» — толщина = меньшее число
    const mm = t.match(/(\d+(?:[.,]\d+)?)\s*мм/i);
    if (mm) return normSize(mm[1]);
    const all = nums(triple?.[0] ?? pair?.[0] ?? t).map((x) => [x, parseFloat(x.replace(',', '.'))] as const).filter(([, n]) => n > 0);
    return all.length ? normSize(all.sort((a, b) => a[1] - b[1])[0][0]) : '';
  }
  if (triple) return normSize(triple[0]);
  const round = /труб/.test(low(rec.name)) && !/профил/.test(low(rec.name));
  if (dia) return normSize('∅' + dia[1] + (dia[2] ? '×' + dia[2] : ''));
  if (pair) return normSize((round ? '∅' : '') + pair[0]);
  return '';
}

const stem = (v: unknown) => low(v).replace(/[аяыиуюоеь]+$/, '');
/** Части справочника «Части изделия» по названиям частей изделия: «Стойки» ↔ «Стойка» (без окончания). Нет в справочнике — пропуск (часть не выдумываем). */
function partIdsByName(names: string[] | undefined, parts: (PartRec & { id: string })[]): string[] {
  const out: string[] = [];
  for (const n of names ?? []) {
    const hit = parts.find((p) => stem(p.name) === stem(n) && stem(n));
    if (hit && !out.includes(hit.id)) out.push(hit.id);
  }
  return out;
}

/** `link` — связь позиции склада с материалом паспорта (МЦ-2, `materials.passportSpec`); без неё — подсказка по названию. */
export type StockLine = { name: string; text: string; /** Названия частей изделия, к которым привязана позиция (products.parts[].lineId → название). */ partNames?: string[]; link?: ManualTexts & { materialId: string; sizes: string[]; isCoating: boolean } | null };
/**
 * «Взять из состава» (МИ.2): позиции склада из «Состава изделия» → строки таблицы. Сначала связь позиции (МЦ-2,
 * `link`; запись справочника удалена/нет среди `recs` — связи нет), иначе подсказка по названию — такие названия
 * идут в `hinted` (человек проверяет). Материалы (kind ≠ coating) — строки
 * с размером (написание из «Сортамента», если такой размер там есть), одинаковый материал — одна строка; покрытия
 * («Краска порошковая») — в coatingIds. Что не подошло ни к одной записи — в unmatched (решает человек).
 */
export function specFromComposition(lines: StockLine[], recs: (MatRec & { id: string })[], sortament: { material?: unknown; name?: unknown }[], parts: (PartRec & { id: string })[] = []) {
  const mats = recs.filter((r) => s(r.kind) !== 'coating');
  const coats = recs.filter((r) => s(r.kind) === 'coating');
  const rows: SpecRow[] = []; const coatingIds: string[] = []; const unmatched: string[] = []; const hinted: string[] = [];
  const coatingTexts: CoatingText[] = [];
  const partsOf = (l: StockLine) => partIdsByName(l.partNames, parts);
  for (const l of lines) {
    if (l.link && recs.some((r) => r.id === l.link!.materialId)) {
      const texts: ManualTexts = { ...(s(l.link.passportText) ? { passportText: s(l.link.passportText) } : {}), ...(s(l.link.techText) ? { techText: s(l.link.techText) } : {}) };
      if (l.link.isCoating) {
        if (!coatingIds.includes(l.link.materialId)) coatingIds.push(l.link.materialId);
        if (Object.keys(texts).length && !coatingTexts.some((c) => c.materialId === l.link!.materialId && c.passportText === texts.passportText && c.techText === texts.techText)) coatingTexts.push({ materialId: l.link.materialId, ...texts });
        continue;
      }
      let lr = rows.find((r) => r.materialId === l.link!.materialId && r.passportText === texts.passportText && r.techText === texts.techText);
      if (!lr) rows.push((lr = { materialId: l.link.materialId, sizes: [], partIds: [], ...texts }));
      for (const p of partsOf(l)) if (!lr.partIds.includes(p)) lr.partIds.push(p);
      for (const z of l.link.sizes) if (!lr.sizes.some((x) => low(normSize(x)) === low(normSize(z)))) lr.sizes.push(z);
      continue;
    }
    const coat = matchMaterial(l.text, coats);
    const mat = coat ? null : matchMaterial(l.text, mats);
    if (coat || mat) { if (!hinted.includes(l.name)) hinted.push(l.name); }
    if (coat) { if (!coatingIds.includes(coat.id)) coatingIds.push(coat.id); continue; }
    if (!mat) { if (!unmatched.includes(l.name)) unmatched.push(l.name); continue; }
    let size = sizeFromStock(l.text, mat);
    const known = sortament.find((x) => s(x.material) === s(mat.code) && low(normSize(x.name)) === low(size));
    if (known) size = s(known.name);
    let row = rows.find((r) => r.materialId === mat.id && !r.passportText && !r.techText);
    if (!row) rows.push((row = { materialId: mat.id, sizes: [], partIds: [] }));
    if (size && !row.sizes.includes(size)) row.sizes.push(size);
    for (const p of partsOf(l)) if (!row.partIds.includes(p)) row.partIds.push(p);
  }
  return { rows, coatingIds, ...(coatingTexts.length ? { coatingTexts } : {}), unmatched, hinted };
}
