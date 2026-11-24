import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { mongo } from 'mongoose';
import { KINDS_DICT } from '../../common/passport/kind';
import { moveOrderedRef } from '../../common/catalog/ordered-refs';
import { reassignProductPassportKind } from '../product/product-writes';
import type { DictBase, Doc, Field } from './dicts.defs';
import { PP_FIELD, ppCode } from './dicts.product-groups';

type Db = mongo.Db;
type Simple = (key: string, group: string, title: string, hint: string, extra: Field[]) => DictBase;
const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const isOid = (v: unknown) => Types.ObjectId.isValid(String(v ?? '')) && String(v).length === 24;
const MAX_ELEMENTS = 3;

/** Кто держит вид: группы изделий (`categories.passportKindId`) и изделия (`products.passportDefaults.kindId`, строкой). */
const groupsOf = (id: unknown) => ({ type: 'product', deletedAt: null, passportKindId: id });
const productsOf = (id: unknown) => ({ deletedAt: null, 'passportDefaults.kindId': String(id) });
const phrasesOf = (id: unknown) => ({ dict: 'passportPhrases', section: 'simple-description', deletedAt: null, kindIds: id });

async function uses(db: Db, ids: unknown[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const [groups, prods, phrases] = await Promise.all([
    db.collection('categories').aggregate([{ $match: { type: 'product', deletedAt: null, passportKindId: { $in: ids } } }, { $group: { _id: '$passportKindId', n: { $sum: 1 } } }]).toArray(),
    db.collection('products').aggregate([{ $match: { deletedAt: null, 'passportDefaults.kindId': { $in: ids.map(String) } } }, { $group: { _id: '$passportDefaults.kindId', n: { $sum: 1 } } }]).toArray(),
    db.collection('dict_values').aggregate([{ $match: phrasesOf({ $in: ids }) }, { $unwind: '$kindIds' }, { $match: { kindIds: { $in: ids } } }, { $group: { _id: '$kindIds', n: { $sum: 1 } } }]).toArray(),
  ]);
  for (const r of [...groups, ...prods, ...phrases]) out.set(String(r._id), (out.get(String(r._id)) ?? 0) + (r.n as number));
  return out;
}

/**
 * «Виды изделий» (C100): вид полностью определяет, что это за изделие (до трёх элементов), назначение (лист раздела «Назначение»)
 * и тип паспорта — без угадывания по названию. Вид задаётся группе изделий (`categories.passportKindId`) или самому изделию
 * (`products.passportDefaults.kindId`). Занятый вид удалить нельзя — 409 всем, перенос через «Объединить с…».
 */
export function passportKindDefs(simple: Simple): DictBase {
  const base = simple(KINDS_DICT, 'Паспорта', 'Виды изделий',
    'Зачем: один ярлык «что это за изделие» для группы или карточки. Пример: «Урна», «Скамья». Вид задаёт тип паспорта, функциональные элементы и назначение. Переименовать элемент — в «Функциональных элементах», здесь только выбор.',
    [
      { ...PP_FIELD, hint: 'Тип паспорта изделий этого вида. Свой тип, заданный в изделии вручную, главнее' },
      { key: 'elementIds', label: 'Функциональные элементы', type: 'select', ref: 'passportElements', multi: true, wide: true, hint: `Ссылки на справочник «Функциональные элементы», не больше ${MAX_ELEMENTS}. Переименовать элемент — там; здесь только выбрать, какие входят в вид.` },
      { key: 'purposeLeafId', label: 'Назначение', type: 'select', ref: 'passportPhrases', refMatch: { section: 'purpose', parentId: { $ne: null } }, wide: true, hint: 'Конечный вариант раздела «Назначение» из «Текстов паспорта»' },
      { key: 'notes', label: 'Примечание', wide: true },
    ]);
  return {
    ...base,
    columns: [{ key: 'passportCategory', label: 'Категория' }, { key: 'elementNames', label: 'Функциональные элементы' }, { key: 'purposeLeafName', label: 'Назначение' }],
    row: (d) => ({
      name: s(d.name), passportCategory: s(d.passportCategory), elementIds: ((d.elementIds as unknown[]) ?? []).map(String),
      purposeLeafId: d.purposeLeafId ? String(d.purposeLeafId) : '', notes: s(d.notes),
    }),
    toDoc: async (b, isNew, db, id) => {
      const cur = id ? await db.collection('dict_values').findOne({ _id: new Types.ObjectId(id) }) : null;
      const has = (k: string) => b[k] !== undefined;
      const name = has('name') ? s(b.name) : s(cur?.name);
      if (!name) throw new BadRequestException('Укажите название вида изделия');
      const passportCategory = has('passportCategory') ? ppCode(b.passportCategory) : cur?.passportCategory ?? null;
      let elementIds: Types.ObjectId[] = ((cur?.elementIds as Types.ObjectId[]) ?? []);
      if (has('elementIds')) {
        const list = Array.isArray(b.elementIds) ? b.elementIds.map(String).filter(Boolean) : [];
        if (!list.every(isOid)) throw new BadRequestException('Некорректный элемент');
        if (list.length > MAX_ELEMENTS) throw new BadRequestException(`Элементов не больше ${MAX_ELEMENTS}`);
        elementIds = list.map((x) => new Types.ObjectId(x));
      }
      let purposeLeafId: Types.ObjectId | null = (cur?.purposeLeafId as Types.ObjectId) ?? null;
      if (has('purposeLeafId')) {
        const v = s(b.purposeLeafId);
        if (!v) purposeLeafId = null;
        else {
          if (!isOid(v)) throw new BadRequestException('Некорректное назначение');
          const leaf = await db.collection('dict_values').findOne({ _id: new Types.ObjectId(v), dict: 'passportPhrases', deletedAt: null }, { projection: { _id: 1 } });
          if (!leaf) throw new BadRequestException('Назначение не найдено — выберите из списка «Тексты паспорта → Назначение»');
          if (await db.collection('dict_values').findOne({ dict: 'passportPhrases', deletedAt: null, parentId: leaf._id }, { projection: { _id: 1 } })) throw new BadRequestException('Выберите конечный вариант назначения, а не раздел с вариантами');
          purposeLeafId = leaf._id as Types.ObjectId;
        }
      }
      return {
        ...(isNew ? { dict: KINDS_DICT, deletedAt: null, createdAt: new Date() } : {}),
        name, passportCategory, elementIds, purposeLeafId, notes: has('notes') ? s(b.notes) || null : cur?.notes ?? null, updatedAt: new Date(),
      };
    },
    beforeRemove: async (db, d: Doc) => {
      const n = (await uses(db, [d._id])).get(String(d._id)) ?? 0;
      if (n > 0) throw new ConflictException(`Вид «${s(d.name)}» используется группами, изделиями или краткими описаниями (${n}), удалить нельзя. Замените его через «Объединить с…».`);
    },
    usage: async (db, docs) => uses(db, docs.map((d) => d._id)),
    busy: async (db, d) => ((await uses(db, [d._id])).get(String(d._id)) ?? 0) > 0,
    related: async (db, d) => {
      const [groups, prods, phrases, total] = await Promise.all([
        db.collection('categories').find(groupsOf(d._id)).sort({ name: 1 }).limit(15).project({ name: 1, groupNo: 1 }).toArray(),
        db.collection('products').find(productsOf(d._id)).sort({ name: 1 }).limit(15).project({ name: 1, sku: 1 }).toArray(),
        db.collection('dict_values').find(phrasesOf(d._id)).sort({ name: 1 }).limit(15).project({ name: 1 }).toArray(),
        uses(db, [d._id]),
      ]);
      return {
        title: 'Группы, изделия и краткие описания с этим видом', total: total.get(String(d._id)) ?? 0,
        items: [
          ...groups.map((g) => ({ label: `Группа ${s(g.name)}`, sub: g.groupNo ? `№ ${s(g.groupNo)}` : '', href: '#dicts?d=productGroups&of=dict&open=' + String(g._id) })),
          ...prods.map((p) => ({ label: `Изделие ${s(p.name)}`, sub: s(p.sku), href: '#products?open=' + String(p._id) })),
          ...phrases.map((p) => ({ label: s(p.name), href: '#dicts?d=passportPhrases&open=' + String(p._id) })),
        ],
      };
    },
    // объединение: группы и изделия переходят на вид, с которым объединяют
    reassign: async (db, from, to) => {
      if (String(from._id) === String(to._id)) return 0;
      const g = await db.collection('categories').updateMany({ type: 'product', passportKindId: from._id }, { $set: { passportKindId: to._id } });
      const p = { modifiedCount: await reassignProductPassportKind(db, from._id, to._id) };
      const ph = await db.collection('dict_values').updateMany(phrasesOf(from._id), moveOrderedRef('kindIds', from._id, to._id));
      return g.modifiedCount + p.modifiedCount + ph.modifiedCount;
    },
    candidates: undefined, fromName: undefined,
  };
}
