import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { mongo } from 'mongoose';
import type { DictBase, Doc, Field } from './dicts.defs';

type Db = mongo.Db;
type Simple = (key: string, group: string, title: string, hint: string, extra: Field[]) => DictBase;
const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const isOid = (v: unknown) => Types.ObjectId.isValid(String(v ?? '')) && String(v).length === 24;
const yes = (v: unknown) => v === true || v === 'true';
const CATEGORIES = ['DIO', 'DSP', 'TRN', 'WRK', 'BLG'];
const FACETS = { dict: 'productFacets', deletedAt: null };
const VALUES = { dict: 'productFacetValues', deletedAt: null };

const oidList = (v: unknown, what: string): Types.ObjectId[] => {
  if (v === undefined || v === null || v === '') return [];
  const list = Array.isArray(v) ? v : s(v).split(/[,;\s]+/).filter(Boolean);
  if (!list.every(isOid)) throw new BadRequestException(`Некорректная ссылка: ${what}`);
  return list.map((x) => new Types.ObjectId(String(x)));
};
const num = (v: unknown, dflt: number) => { const n = Number(String(v ?? '').replace(',', '.')); return s(v) !== '' && Number.isFinite(n) ? n : dflt; };

/** Сколько изделий и текстов паспорта держат значение признака. */
async function valueUses(db: Db, ids: Types.ObjectId[]) {
  const [prod, phr] = await Promise.all([
    db.collection('products').aggregate([{ $match: { deletedAt: null, facetValueIds: { $in: ids } } }, { $unwind: '$facetValueIds' }, { $match: { facetValueIds: { $in: ids } } }, { $group: { _id: '$facetValueIds', n: { $sum: 1 } } }]).toArray(),
    db.collection('dict_values').aggregate([{ $match: { dict: 'passportPhrases', deletedAt: null, facetValueIds: { $in: ids } } }, { $unwind: '$facetValueIds' }, { $match: { facetValueIds: { $in: ids } } }, { $group: { _id: '$facetValueIds', n: { $sum: 1 } } }]).toArray(),
  ]);
  const out = new Map<string, number>();
  for (const r of [...prod, ...phr]) out.set(String(r._id), (out.get(String(r._id)) ?? 0) + (r.n as number));
  return out;
}

/**
 * «Признаки продукции» и «Значения признаков» (C028, паспорт воронкой): признак привязан к типу паспорта (шаг воронки),
 * значение — к признаку по id (`parentId`); у изделия значения лежат в `products.facetValueIds`. Связи по id: переименование безопасно.
 */
export function productFacetDefs(simple: Simple): DictBase[] {
  const facetsBase = simple('productFacets', 'Паспорта', 'Признаки продукции',
    'По каким признакам сужается выбор изделия при создании паспорта (для тренажёров — вид, группа мышц…). Признак относится к одной типа паспорта; его значения — в «Значениях признаков».',
    [
      { key: 'category', label: 'Тип паспорта', type: 'select', required: true, options: CATEGORIES.map((v) => ({ value: v, label: v })) },
      { key: 'order', label: 'Порядок', hint: 'Число: чем меньше, тем раньше шаг' },
      { key: 'step', label: 'Шаг воронки', type: 'select', bool: true, options: [{ value: 'true', label: 'да' }], hint: 'Спрашивать при создании паспорта' },
      { key: 'multi', label: 'Можно несколько значений', type: 'select', bool: true, options: [{ value: 'true', label: 'да' }] },
      { key: 'hint', label: 'Подсказка менеджеру', wide: true },
      { tech: true, key: 'code', label: 'Код признака', required: true, lockAfterCreate: true, hint: 'Короткое имя латиницей (trn.kind). После создания не меняется' },
    ]);
  const facets: DictBase = {
    ...facetsBase,
    row: (d) => ({ name: s(d.name), code: s(d.code), category: s(d.category), order: num(d.order, 0), step: d.step === true, multi: d.multi === true, hint: s(d.hint) }),
    toDoc: async (b, isNew, db, id) => {
      const name = s(b.name), code = s(b.code), category = s(b.category);
      if (!name) throw new BadRequestException('Укажите название признака');
      if (!CATEGORIES.includes(category)) throw new BadRequestException('Тип паспорта: одна из ' + CATEGORIES.join(', '));
      const cur = id ? await db.collection('dict_values').findOne({ _id: new Types.ObjectId(id) }) : null;
      const had = s(cur?.code);
      const c = code || had;
      if (!c) throw new BadRequestException('Укажите код признака');
      if (had && c !== had) throw new BadRequestException('Код признака нельзя менять: на него ссылаются значения');
      if (await db.collection('dict_values').findOne({ ...FACETS, code: c, ...(id ? { _id: { $ne: new Types.ObjectId(id) } } : {}) }, { projection: { _id: 1 } })) throw new ConflictException(`Код «${c}» уже занят другим признаком`);
      return { ...(isNew ? { dict: 'productFacets', deletedAt: null, createdAt: new Date() } : {}), name, code: c, category, order: num(b.order, cur?.order ?? 0), step: b.step === undefined ? cur?.step === true : yes(b.step), multi: b.multi === undefined ? cur?.multi === true : yes(b.multi), hint: s(b.hint) || null, updatedAt: new Date() };
    },
    beforeRemove: async (db, d) => {
      if (await db.collection('dict_values').countDocuments({ ...VALUES, parentId: d._id })) throw new ConflictException(`У признака «${s(d.name)}» есть значения — сначала уберите их`);
    },
    usage: async (db, docs) => {
      const rows = await db.collection('dict_values').aggregate([{ $match: { ...VALUES, parentId: { $in: docs.map((d) => d._id) } } }, { $group: { _id: '$parentId', n: { $sum: 1 } } }]).toArray();
      return new Map(rows.map((r) => [String(r._id), r.n as number]));
    },
    busy: async (db, d) => (await db.collection('dict_values').countDocuments({ ...VALUES, parentId: d._id }, { limit: 1 })) > 0,
    related: async (db, d) => {
      const q = { ...VALUES, parentId: d._id };
      const [rows, total] = await Promise.all([db.collection('dict_values').find(q).limit(15).project({ name: 1 }).toArray(), db.collection('dict_values').countDocuments(q)]);
      return { title: 'Значения признака', total, items: rows.map((r) => ({ label: s(r.name), href: '#dicts?d=productFacetValues&of=dict&open=' + String(r._id) })) };
    },
    reassign: async (db, from, to) => (String(from._id) === String(to._id) ? 0 : (await db.collection('dict_values').updateMany({ ...VALUES, parentId: from._id }, { $set: { parentId: to._id } })).modifiedCount),
    candidates: undefined, fromName: undefined,
    editRoles: ['director'],
  };

  const valuesBase = simple('productFacetValues', 'Паспорта', 'Значения признаков',
    'Варианты признаков: «Силовой», «Кардио»… Значение выбирают у изделия — по названию оно не угадывается.',
    [
      { key: 'parentId', label: 'Признак', type: 'select', ref: 'productFacets', required: true },
      { key: 'order', label: 'Порядок', hint: 'Число: чем меньше, тем выше значение в списке' },
      { key: 'purposePhraseId', label: 'Назначение (текст)', type: 'select', ref: 'passportPhrases', hint: 'Текст «Назначение» паспорта для изделий с этим значением' },
      { key: 'installTypeId', label: 'Способ установки', type: 'select', ref: 'passportInstall' },
      { key: 'elementIds', label: 'Элементы', type: 'select', ref: 'passportElements', multi: true, wide: true },
      { tech: true, key: 'code', label: 'Код значения', required: true, lockAfterCreate: true, hint: 'Короткое имя латиницей (trn.kind.power). После создания не меняется' },
    ]);
  const values: DictBase = {
    ...valuesBase,
    row: (d) => ({
      name: s(d.name), code: s(d.code), parentId: d.parentId ? String(d.parentId) : '', order: num(d.order, 0),
      purposePhraseId: d.purposePhraseId ? String(d.purposePhraseId) : '', installTypeId: d.installTypeId ? String(d.installTypeId) : '',
      elementIds: ((d.elementIds as unknown[]) ?? []).map(String),
    }),
    toDoc: async (b, isNew, db, id) => {
      const name = s(b.name);
      if (!name) throw new BadRequestException('Укажите название значения');
      const cur = id ? await db.collection('dict_values').findOne({ _id: new Types.ObjectId(id) }) : null;
      const has = (k: string) => b[k] !== undefined;
      const parent = has('parentId') ? s(b.parentId) : cur?.parentId ? String(cur.parentId) : '';
      if (!isOid(parent) || !(await db.collection('dict_values').findOne({ ...FACETS, _id: new Types.ObjectId(parent) }, { projection: { _id: 1 } }))) throw new BadRequestException('Выберите признак из списка');
      const had = s(cur?.code), c = s(b.code) || had;
      if (!c) throw new BadRequestException('Укажите код значения');
      if (had && c !== had) throw new BadRequestException('Код значения нельзя менять: на него ссылаются изделия и тексты');
      if (await db.collection('dict_values').findOne({ ...VALUES, code: c, ...(id ? { _id: { $ne: new Types.ObjectId(id) } } : {}) }, { projection: { _id: 1 } })) throw new ConflictException(`Код «${c}» уже занят другим значением`);
      const one = (k: string, what: string) => { if (!has(k)) return cur?.[k] ?? null; const v = s(b[k]); if (!v) return null; if (!isOid(v)) throw new BadRequestException(`Некорректная ссылка: ${what}`); return new Types.ObjectId(v); };
      return {
        ...(isNew ? { dict: 'productFacetValues', deletedAt: null, createdAt: new Date() } : {}),
        name, code: c, parentId: new Types.ObjectId(parent), order: num(b.order, cur?.order ?? 0),
        purposePhraseId: one('purposePhraseId', 'назначение'), installTypeId: one('installTypeId', 'способ установки'),
        elementIds: has('elementIds') ? oidList(b.elementIds, 'элементы') : cur?.elementIds ?? [],
        updatedAt: new Date(),
      };
    },
    dupKey: (d) => `${d.parentId ? String(d.parentId) : ''}|${s(d.name).toLowerCase()}`,
    usage: async (db, docs) => valueUses(db, docs.map((d) => d._id)),
    busy: async (db, d) => ((await valueUses(db, [d._id])).get(String(d._id)) ?? 0) > 0,
    related: async (db, d) => {
      const q = { deletedAt: null, facetValueIds: d._id };
      const [rows, total] = await Promise.all([db.collection('products').find(q).sort({ name: 1 }).limit(15).project({ name: 1, sku: 1 }).toArray(), db.collection('products').countDocuments(q)]);
      return { title: 'Изделия с этим значением', total, items: rows.map((r) => ({ label: s(r.name), sub: s(r.sku), href: '#products?open=' + String(r._id) })) };
    },
    // объединение: сначала добавить новое значение, потом убрать старое (иначе $pull после $addToSet не нужен, а порядок обратный стёр бы связь)
    reassign: async (db, from: Doc, to: Doc) => {
      if (String(from._id) === String(to._id)) return 0;
      let n = 0;
      for (const [coll, extra] of [['products', {}], ['dict_values', { dict: 'passportPhrases' }]] as const) {
        const q = { ...extra, facetValueIds: from._id };
        const r = await db.collection(coll).updateMany(q, { $addToSet: { facetValueIds: to._id } });
        await db.collection(coll).updateMany(q, { $pull: { facetValueIds: from._id } } as never);
        n += r.modifiedCount;
      }
      return n;
    },
    candidates: undefined, fromName: undefined,
    editRoles: ['director'],
  };
  return [facets, values];
}
