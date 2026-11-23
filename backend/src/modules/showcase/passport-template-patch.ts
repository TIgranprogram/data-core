import { exerciseInstructions } from '../../common/passport/exercise-instructions';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { checkChoices, toNode } from '../../common/passport/phrase-tree';
import { MAX_OVERRIDE_TEXT } from '../../common/passport/text-overrides';
import { renderSelectedParts, selectedPartsIssue, type SimpleDescription } from '../../common/passport/simple-description';
import { MANUAL_TEXT_KEYS, normalizePassportDefaults, NUMS, PRESENTATION_DEFAULT_KEYS } from './passport-defaults';
import type { Db } from './showcase-common';
import { resolveKind } from '../../common/passport/kind';
import { inheritedPassportCategory } from '../../common/passport/passport-inherit';

type Rec = Record<string, unknown>;
const MAP_KEYS = ['textChoices', 'textOverrides'] as const;
const arrays = ['elements', 'materialIds', 'manualText', 'modules', 'joints'];
const editable = new Set<string>([
  'passportCategory', 'kindId', 'installationTypeId', 'isKit', 'seatsCount', 'facetValueIds',
  ...arrays, ...MAP_KEYS, ...NUMS, ...PRESENTATION_DEFAULT_KEYS,
]);
const error = (key: string) => new BadRequestException(`${key}: неверное значение`);
const isRec = (x: unknown): x is Rec => !!x && typeof x === 'object' && Object.getPrototypeOf(x) === Object.prototype;
const has = (x: Rec, key: string) => Object.prototype.hasOwnProperty.call(x, key);

function id(v: unknown, key: string) {
  if (typeof v !== 'string' || !Types.ObjectId.isValid(v)) throw error(key);
  return new Types.ObjectId(v);
}

function allowed(x: unknown, keys: readonly string[], key: string): Rec {
  if (!isRec(x)) throw error(key);
  const unknown = Object.keys(x).find((k) => !keys.includes(k));
  if (unknown) throw error(`${key}.${unknown}`);
  return x;
}

function sameKeys(changes: Rec, expected: Rec, key: string) {
  const keys = Object.keys(changes);
  if (!keys.length || keys.length !== Object.keys(expected).length || keys.some((k) => !has(expected, k))) {
    throw new BadRequestException(`${key}: у changes и expected должны совпадать непустые наборы ключей`);
  }
  return keys;
}

function nonemptyText(raw: unknown, key: string) {
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > MAX_OVERRIDE_TEXT) throw error(key);
  return raw.replace(/\r\n/g, '\n').trim();
}

function simpleDescription(raw: unknown, expected: boolean): SimpleDescription<Types.ObjectId> | null {
  if (raw === null) return null;
  const x = allowed(raw, ['mode', 'text', 'partIds'], 'simpleDescription');
  if (x.mode !== undefined && x.mode !== 'parts' && x.mode !== 'manual') throw error('simpleDescription.mode');
  if (!Array.isArray(x.partIds) || x.partIds.length > 100) throw error('simpleDescription.partIds');
  const values = x.partIds.map((p) => id(p, 'simpleDescription.partIds'));
  // CAS сравнивает прежние ссылки в их порядке, даже если старое значение требует исправления.
  const partIds = expected ? values : [...new Set(values.map(String))].map((p) => new Types.ObjectId(p));
  if (x.mode === 'parts') {
    if (!expected && !partIds.length) throw new BadRequestException('simpleDescription.partIds: выберите части изделия');
    if (expected && has(x, 'text')) throw error('simpleDescription.text');
    return { mode: 'parts', partIds };
  }
  if (expected && typeof x.text !== 'string') throw error('simpleDescription.text');
  const text = expected ? x.text as string : nonemptyText(x.text, 'simpleDescription.text');
  return x.mode === 'manual' ? { mode: 'manual', text, partIds } : { text, partIds };
}

function valueOf(key: string, v: unknown) {
  if (v === null) return null;
  if (key === 'manualDescription' || key === 'manualPurpose' || key === 'manualInstall') return nonemptyText(v, key);
  if (key === 'isKit' && typeof v !== 'boolean') throw error(key);
  if (arrays.includes(key) && !Array.isArray(v)) throw error(key);
  if (key === 'manualText' && (v as unknown[]).some((m) => !(MANUAL_TEXT_KEYS as readonly unknown[]).includes(m))) throw error(key);
  if (key === 'modules') for (const m of v as unknown[]) {
    const o = allowed(m, ['name', 'dims', 'qty', 'photoId'], key);
    if (typeof o.name !== 'string' || (o.dims !== undefined && typeof o.dims !== 'string')
      || (o.photoId !== undefined && typeof o.photoId !== 'string') || typeof o.qty !== 'number') throw error(key);
  }
  if ([...NUMS, 'seatsCount'].includes(key) && typeof v !== 'number') throw error(key);
  if (['passportCategory', 'kindId', 'installationTypeId'].includes(key) && (typeof v !== 'string' || !v.trim())) throw error(key);
  if (key === 'elements' || key === 'materialIds') return (v as unknown[]).map((x) => id(x, key));
  if (Array.isArray(v) && !v.length) return [];
  const out = normalizePassportDefaults({ [key]: v });
  if (!has(out, key)) throw error(key);
  return out[key];
}

function rootValue(key: string, raw: unknown) {
  if (raw === null) return null;
  if (key === 'textChoices') return id(raw, key).toHexString();
  const x = allowed(raw, ['text', 'off'], key);
  if (Object.keys(x).length !== 1) throw error(key);
  if (x.off === true) return { off: true };
  return { text: nonemptyText(x.text, key) };
}

/** Оба редактора оперируют только собственными значениями. Корни карт — отдельные единицы разрешения конфликтов. */
export function parseTemplatePatch(changes: Rec, expected: Rec) {
  const to: Rec = {}, from: Rec = {};
  for (const key of sameKeys(changes, expected, 'Шаблон')) {
    if (!editable.has(key)) throw error(key);
    if ((MAP_KEYS as readonly string[]).includes(key)) {
      const a = changes[key], b = expected[key];
      if (!isRec(a) || !isRec(b)) throw error(key);
      for (const root of sameKeys(a, b, key)) {
        id(root, key);
        const path = `${key}.${root}`;
        to[path] = rootValue(key, a[root]);
        from[path] = rootValue(key, b[root]);
      }
    } else if (key === 'facetValueIds') {
      const parse = (raw: unknown) => {
        if (raw === null) return null;
        if (!Array.isArray(raw) || raw.length > 100) throw error(key);
        return raw.map((v) => id(v, key));
      };
      const values = parse(changes[key]);
      to[key] = values === null ? null : [...new Map(values.map((v) => [String(v), v])).values()];
      from[key] = parse(expected[key]);
    } else if (key === 'exerciseInstructions') {
      to[key] = changes[key] === null ? null : exerciseInstructions(changes[key]);
      from[key] = expected[key] === null ? null : exerciseInstructions(expected[key], true);
    } else if (key === 'simpleDescription') {
      to[key] = simpleDescription(changes[key], false);
      from[key] = simpleDescription(expected[key], true);
    } else {
      to[key] = valueOf(key, changes[key]);
      from[key] = valueOf(key, expected[key]);
    }
  }
  return { to, from };
}

function replaceKeys(path: string, changes: Rec) {
  const existing = { $arrayToObject: { $filter: {
    input: { $objectToArray: { $ifNull: [path, {}] } },
    as: 'entry',
    cond: { $not: [{ $in: ['$$entry.k', Object.keys(changes)] }] },
  } } };
  return { $mergeObjects: [
    existing,
    ...Object.entries(changes).filter(([, v]) => v !== null).map(([k, v]) => ({ [k]: v })),
  ] };
}

function compareOwnValue(path: string, key: string, value: unknown) {
  const current = `${path}.${key}`;
  if (!['simpleDescription', 'exerciseInstructions'].includes(key) || value === null) return { $eq: [{ $ifNull: [current, null] }, { $literal: value }] };
  // BSON учитывает порядок ключей объекта. Порядок ссылок внутри partIds остаётся частью сравнения.
  const fields = Object.entries(value as Rec).map(([k, v]) => ({ k, v }));
  return { $cond: [{ $eq: [{ $type: current }, 'object'] }, { $setEquals: [{ $objectToArray: current }, { $literal: fields }] }, false] };
}

export async function patchPassportTemplate(db: Db, productId: Types.ObjectId, changes: Rec, expected: Rec) {
  const filter = { _id: productId, deletedAt: null };
  const products = db.collection('products');
  const product = await products.findOne(filter);
  if (!product) throw new NotFoundException('Изделие не найдено');
  const { to, from } = parseTemplatePatch(changes, expected);
  const dv = db.collection('dict_values');
  const facets = to.facetValueIds as Types.ObjectId[] | null | undefined;
  if (facets?.length) {
    const rows = await dv.find({ _id: { $in: facets }, dict: 'productFacetValues', deletedAt: null }, { projection: { parentId: 1 } }).toArray();
    if (rows.length !== facets.length || rows.some((r) => !r.parentId || !Types.ObjectId.isValid(String(r.parentId)))) throw error('facetValueIds');
    const parents = [...new Set(rows.map((r) => String(r.parentId)))].map((v) => new Types.ObjectId(v));
    const definitions = await dv.find({ _id: { $in: parents }, dict: 'productFacets', deletedAt: null }, { projection: { category: 1, multi: 1 } }).toArray();
    if (definitions.length !== parents.length) throw error('facetValueIds');
    const defaults = { ...(product.passportDefaults ?? {}) };
    for (const key of ['kindId', 'passportCategory']) if (has(to, key)) {
      if (to[key] === null) delete defaults[key]; else defaults[key] = to[key];
    }
    const resolvedCategory = String(defaults.passportCategory ?? '').trim()
      || (await resolveKind(db, { ...product, passportDefaults: defaults })).kind?.passportCategory
      || (await inheritedPassportCategory(db, product.categoryId))?.code;
    const category = resolvedCategory === 'MAF' ? 'BLG' : resolvedCategory;
    for (const definition of definitions) {
      const ownIds = new Set((Array.isArray(product.facetValueIds) ? product.facetValueIds : []).map(String));
      const added = rows.some((r) => String(r.parentId) === String(definition._id) && !ownIds.has(String(r._id)));
      if (added && category && definition.category !== category) throw new BadRequestException('facetValueIds: признак относится к другому типу паспорта');
      if (definition.multi !== true && rows.filter((r) => String(r.parentId) === String(definition._id)).length > 1) {
        throw new BadRequestException('facetValueIds: у признака можно выбрать только одно значение');
      }
    }
  }
  const description = to.simpleDescription as SimpleDescription<Types.ObjectId> | undefined;
  const links = {
    'simpleDescription.partIds': ['passportParts', description?.mode === 'parts' ? [] : description?.partIds],
    kindId: ['passportKinds', to.kindId ? [new Types.ObjectId(String(to.kindId))] : []],
    installationTypeId: ['passportInstall', to.installationTypeId ? [to.installationTypeId] : []],
    elements: ['passportElements', to.elements],
    materialIds: ['passportMaterials', to.materialIds],
  } as const;
  await Promise.all(Object.entries(links).map(async ([key, [dict, raw]]) => {
    const ids = [...new Set(((raw as Types.ObjectId[] | undefined) ?? []).map(String))].map((value) => new Types.ObjectId(value));
    if (ids.length && await dv.countDocuments({ _id: { $in: ids }, dict, deletedAt: null }) !== ids.length) throw error(key);
  }));
  if (description?.mode === 'parts') {
    const partIds = description.partIds.map(String);
    const rows = await dv.find({ _id: { $in: description.partIds }, dict: 'passportParts', deletedAt: null },
      { projection: { name: 1, genSingular: 1 } }).toArray();
    const parts = new Map(rows.map((row) => [String(row._id), { name: row.name, genSingular: row.genSingular }]));
    const result = renderSelectedParts(partIds, parts);
    const issue = selectedPartsIssue({ kind: 'parts', partIds, ...result });
    if (issue) throw new BadRequestException(`simpleDescription.partIds: ${issue.label}. ${issue.hint}`);
  }
  const choices = Object.fromEntries(Object.entries(to).filter(([k, v]) => k.startsWith('textChoices.') && v !== null).map(([k, v]) => [k.split('.')[1], String(v)]));
  const overrideRoots = Object.keys(to).filter((k) => k.startsWith('textOverrides.') && to[k] !== null).map((k) => k.split('.')[1]);
  if (Object.keys(choices).length || overrideRoots.length) {
    const nodes = (await dv.find({ dict: 'passportPhrases', deletedAt: null }).toArray()).map(toNode);
    const invalid = checkChoices(nodes, choices);
    if (invalid) throw new BadRequestException(`textChoices: ${invalid}`);
    if (overrideRoots.some((root) => !nodes.some((n) => n.id === root && !n.parentId))) throw error('textOverrides');
  }
  const path = '$passportDefaults';
  const fields: Rec = Object.fromEntries(Object.entries(to).filter(([k]) => !k.includes('.') && k !== 'facetValueIds').map(([k, v]) => [k, v === null ? null : { $literal: v }]));
  for (const map of MAP_KEYS) {
    const roots = Object.fromEntries(Object.entries(to).filter(([k]) => k.startsWith(map + '.')).map(([k, v]) => [k.split('.')[1], v === null ? null : { $literal: v }]));
    if (Object.keys(roots).length) fields[map] = replaceKeys(`${path}.${map}`, roots);
  }
  const compare = Object.entries(from).map(([k, v]) => compareOwnValue(k === 'facetValueIds' ? '$$ROOT' : path, k, v));
  // Валидация признаков относится к прочитанной категории. Её параллельная смена требует перечитать шаблон.
  if (facets?.length) {
    compare.push(compareOwnValue('$$ROOT', 'categoryId', product.categoryId ?? null));
    for (const key of ['kindId', 'passportCategory']) if (!has(from, key)) compare.push(compareOwnValue(path, key, product.passportDefaults?.[key] ?? null));
  }
  const set: Rec = { updatedAt: new Date() };
  if (Object.keys(fields).length) set.passportDefaults = replaceKeys(path, fields);
  if (has(to, 'facetValueIds')) set.facetValueIds = facets === null ? '$$REMOVE' : { $literal: facets };
  // Mongo 4.4: конвейер атомарно инициализирует null/отсутствующее поле и сливает только затронутые пути.
  const result = await products.updateOne({ ...filter, $expr: { $and: compare } }, [
    { $set: set },
  ]);
  if (!result.matchedCount) {
    if (!(await products.findOne(filter, { projection: { _id: 1 } }))) throw new NotFoundException('Изделие не найдено');
    throw new ConflictException('Настройки изменились — перечитайте книжку');
  }
}
