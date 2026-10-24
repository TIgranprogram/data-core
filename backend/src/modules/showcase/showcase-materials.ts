import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { oid } from '../../common/list-query';
import { composeMaterialsText, normSize, specFromComposition, type MaterialsSpec, type MatRec, type PartRec } from '../../common/catalog/materials-text';
import { clean, type Db, type Doc } from './showcase-common';

/**
 * Материалы изделия таблицей (Фаза МИ): `products.materialsSpec` — новое поле только data-core (CRM его не читает):
 * { rows: [{ materialId, sizes[], partIds[] }], coatingIds[] }; id — записи справочников «Материалы и покрытия»
 * (`passportMaterials`) и «Части изделия» (`passportParts`), размеры — строками без «мм». Текст — `common/catalog/materials-text.ts`.
 */
export type StoredSpec = { rows: { materialId: Types.ObjectId; sizes: string[]; partIds: Types.ObjectId[] }[]; coatingIds: Types.ObjectId[] };
const MAX_ROWS = 50, MAX_SIZES = 20, MAX_PARTS = 30, MAX_COATINGS = 10;

const ids = (v: unknown, what: string, max: number) => {
  if (v === undefined || v === null || v === '') return [];
  if (!Array.isArray(v)) throw new BadRequestException(`${what} — список`);
  const out: Types.ObjectId[] = [];
  for (const x of v) { const id = oid(x, what); if (!out.some((o) => o.equals(id))) out.push(id); }
  if (out.length > max) throw new BadRequestException(`${what}: не больше ${max}`);
  return out;
};

/**
 * Тело запроса → запись. null / пусто — снять (null). Пустые строки таблицы пропускаются; строка с размерами или частями
 * без материала — 400. Размеры — одно написание (`normSize`), без дублей.
 */
export function parseMaterialsSpec(v: unknown): StoredSpec | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'object' || Array.isArray(v)) throw new BadRequestException('materialsSpec — объект { rows, coatingIds }');
  const b = v as Record<string, unknown>;
  if (b.rows !== undefined && b.rows !== null && !Array.isArray(b.rows)) throw new BadRequestException('materialsSpec.rows — список строк');
  const raw = (b.rows as unknown[] | undefined) ?? [];
  if (raw.length > MAX_ROWS) throw new BadRequestException(`Материалов изделия: не больше ${MAX_ROWS} строк`);
  const rows: StoredSpec['rows'] = [];
  raw.forEach((r0, i) => {
    const r = (r0 && typeof r0 === 'object' ? r0 : {}) as Record<string, unknown>;
    if (r.sizes !== undefined && r.sizes !== null && !Array.isArray(r.sizes)) throw new BadRequestException(`Строка ${i + 1}: размеры — список`);
    const sizes = [...new Set(((r.sizes as unknown[]) ?? []).map(normSize).filter(Boolean))];
    if (sizes.length > MAX_SIZES) throw new BadRequestException(`Строка ${i + 1}: размеров не больше ${MAX_SIZES}`);
    if (sizes.some((z) => z.length > 40)) throw new BadRequestException(`Строка ${i + 1}: размер длиннее 40 знаков`);
    const partIds = ids(r.partIds, `части изделия (строка ${i + 1})`, MAX_PARTS);
    if (!clean(r.materialId)) {
      if (sizes.length || partIds.length) throw new BadRequestException(`Строка ${i + 1}: выберите материал`);
      return;
    }
    rows.push({ materialId: oid(r.materialId, `материала (строка ${i + 1})`), sizes, partIds });
  });
  const coatingIds = ids(b.coatingIds, 'покрытия', MAX_COATINGS);
  return rows.length || coatingIds.length ? { rows, coatingIds } : null;
}

/** Запись → ответ API (id строками); нет — null. */
export function presentMaterialsSpec(v: unknown): MaterialsSpec | null {
  const sp = v as StoredSpec | null | undefined;
  if (!sp || typeof sp !== 'object') return null;
  return {
    rows: (sp.rows ?? []).map((r) => ({ materialId: String(r.materialId), sizes: (r.sizes ?? []).map(String), partIds: (r.partIds ?? []).map(String) })),
    coatingIds: (sp.coatingIds ?? []).map(String),
  };
}

export class ShowcaseMaterials {
  constructor(private readonly dbOf: () => Db) {}
  private get db() { return this.dbOf(); }

  private async dict(dict: string, list: Types.ObjectId[], live = false) {
    if (!list.length) return [];
    return this.db.collection('dict_values').find({ dict, _id: { $in: list }, ...(live ? { deletedAt: null } : {}) }).toArray();
  }

  /** Ссылки — на живые записи справочников; иначе 400 (выбор только из справочника). */
  async check(sp: StoredSpec | null) {
    if (!sp) return;
    const mIds = [...sp.rows.map((r) => r.materialId), ...sp.coatingIds];
    const pIds = sp.rows.flatMap((r) => r.partIds);
    const [m, p] = await Promise.all([this.dict('passportMaterials', mIds, true), this.dict('passportParts', pIds, true)]);
    const has = (list: { _id: unknown }[], id: Types.ObjectId) => list.some((x) => id.equals(x._id as Types.ObjectId));
    if (mIds.some((id) => !has(m, id))) throw new BadRequestException('Материал или покрытие не найдено в справочнике «Материалы и покрытия»');
    if (pIds.some((id) => !has(p, id))) throw new BadRequestException('Часть изделия не найдена в справочнике «Части изделия»');
  }

  /** Собранный текст «Изготовлено из…» (МИ.3); записи справочников — и из корзины (текст не пропадает). */
  async text(sp: MaterialsSpec | null): Promise<string> {
    if (!sp) return '';
    const toOid = (x: string) => (Types.ObjectId.isValid(x) ? [new Types.ObjectId(x)] : []);
    const [m, p] = await Promise.all([
      this.dict('passportMaterials', [...sp.rows.map((r) => r.materialId), ...sp.coatingIds].flatMap(toOid)),
      this.dict('passportParts', sp.rows.flatMap((r) => r.partIds).flatMap(toOid)),
    ]);
    return composeMaterialsText(sp, new Map(m.map((x) => [String(x._id), x as MatRec])), new Map(p.map((x) => [String(x._id), x as PartRec])));
  }

  /** «Взять из состава» (МИ.2): предложение таблицы по материалам «Состава изделия»; ничего не записывает. */
  async fromComposition(id: string) {
    const d = (await this.db.collection('products').findOne({ _id: oid(id, 'изделия') }, { projection: { composition: 1 } })) as Doc | null;
    if (!d) throw new NotFoundException('Изделие не найдено');
    const refs = ((d.composition as Record<string, unknown>[] | undefined) ?? []).filter((l) => l.lineType === 'material' && l.refId).map((l) => l.refId as Types.ObjectId);
    const [stock, recs, sortament] = await Promise.all([
      refs.length ? this.db.collection('materials').find({ _id: { $in: refs } }, { projection: { name: 1, assortment: 1, materialGrade: 1, dimensions: 1 } }).toArray() : [],
      this.db.collection('dict_values').find({ dict: 'passportMaterials', deletedAt: null }).toArray(),
      this.db.collection('dict_values').find({ dict: 'passportSortament', deletedAt: null }, { projection: { name: 1, material: 1 } }).toArray(),
    ]);
    const byId = new Map(stock.map((x) => [String(x._id), x]));
    const lines = refs.map((r) => byId.get(String(r))).filter(Boolean).map((x) => {
      const text = [x!.name, x!.assortment, x!.materialGrade].map(clean).filter(Boolean).join(' ');
      // размер не в названии — из габаритов позиции (диаметр × толщина / толщина)
      const dim = (t: string) => ((x!.dimensions as { type?: string; value?: number }[] | undefined) ?? []).find((z) => z.type === t)?.value;
      const extra = /\d/.test(text) ? '' : dim('diameter') ? ` ∅${dim('diameter')}${dim('thickness') ? '×' + dim('thickness') : ''}` : dim('thickness') ? ` ${dim('thickness')} мм` : '';
      return { name: clean(x!.name), text: text + extra };
    });
    const r = specFromComposition(lines, recs.map((x) => ({ ...(x as MatRec), id: String(x._id) })), sortament as { material?: unknown; name?: unknown }[]);
    const materialsSpec: MaterialsSpec = { rows: r.rows, coatingIds: r.coatingIds };
    return { materialsSpec, materialsText: await this.text(materialsSpec), unmatched: r.unmatched };
  }
}
