import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { mongo } from 'mongoose';
import { checkNode, leavesOf, buildForest, rootIdOf, toNode, type PhraseNode } from '../../common/passport/phrase-tree';
import type { DictDef, Doc } from './dicts.defs';

type Db = mongo.Db;
const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const isOid = (v: unknown) => Types.ObjectId.isValid(String(v ?? '')) && String(v).length === 24;
const yes = (v: unknown) => v === true || v === 'true';
const SECTION_RE = /^[a-z][a-z0-9_-]{1,30}$/;

/** Живые узлы дерева текстов паспорта. */
const loadNodes = async (db: Db): Promise<PhraseNode[]> => (await db.collection('dict_values').find({ dict: 'passportPhrases', deletedAt: null }).toArray()).map((r) => toNode(r));

/**
 * «Тексты паспорта» (воронка, ПВ 2026-10-25): дерево раздел → варианты → подварианты в `dict_values`. Надстройка над простым
 * списком: проверки структуры при записи, «Используется» по выборам в паспортах и изделиях (`textChoices`), удаление узла с
 * вариантами — отказ. Старые поля (`section`, `categories`, `text`) прежние; выданные паспорта хранят свой снимок текста.
 */
export function passportPhrasesDef(base: DictDef): DictDef {
  const rootOf = (all: PhraseNode[], id: string) => rootIdOf(new Map(all.map((n) => [n.id, n])), id);
  /** Листья, чьи выборы считаются «использованием» узла: сам лист или все листья ветки. */
  const leafIdsOf = (all: PhraseNode[], d: Doc) => {
    const tree = buildForest(all);
    const find = (ns: ReturnType<typeof buildForest>): ReturnType<typeof buildForest>[number] | null => { for (const n of ns) { if (n.id === String(d._id)) return n; const f = find(n.children); if (f) return f; } return null; };
    const node = find(tree);
    return node ? leavesOf(node).map((l) => l.id) : [String(d._id)];
  };
  const legacyField = (d: Doc) => (d.section === 'installation' ? 'installationMethod' : 'purpose');

  return {
    ...base,
    fields: [
      { key: 'name', label: 'Название (у раздела — вопрос)', required: true, wide: true },
      { key: 'section', label: 'Раздел (только у раздела верхнего уровня)', type: 'select', options: [
        { value: 'purpose', label: 'Назначение' }, { value: 'installation', label: 'Установка' }, { value: 'mounting', label: 'Монтаж' },
        { value: 'use', label: 'Правила пользования' }, { value: 'service', label: 'Техническое обслуживание' }, { value: 'general', label: 'Общие указания' },
        { value: 'storage', label: 'Хранение' }, { value: 'transport', label: 'Транспортирование' }, { value: 'repair', label: 'Ремонт' }] },
      { key: 'parentId', label: 'Родитель (id узла; пусто — раздел)', hint: 'Раздел → варианты → подварианты, не больше 4 уровней' },
      { key: 'categories', label: 'Категории', wide: true, hint: 'Коды категорий через запятую: TRN, WRK, BLG (благоустройство), DIO, DSP' },
      { key: 'allCategories', label: 'Для всех категорий', type: 'select', bool: true, options: [{ value: 'true', label: 'да' }] },
      { key: 'order', label: 'Порядок среди соседей' },
      { key: 'required', label: 'Раздел обязателен', type: 'select', bool: true, options: [{ value: 'true', label: 'да' }], hint: 'Только у раздела: без выбора паспорт не выпустить' },
      { key: 'isDefault', label: 'По умолчанию', type: 'select', bool: true, options: [{ value: 'true', label: 'да' }], hint: 'Подставляется, пока не выбран другой вариант' },
      { key: 'installTypeId', label: 'Способ установки (id)', hint: 'У варианта раздела «Установка»: выбор сам ставит способ установки паспорта' },
      { key: 'slot', label: 'Номер пункта раздела шаблона', hint: 'У раздела: какой по счёту пункт раздела шаблона заменяет выбранный текст (по умолчанию 1)' },
      { key: 'text', label: 'Текст (только у конечного варианта)', type: 'textarea', wide: true },
    ],
    columns: [{ key: 'section', label: 'Раздел' }, { key: 'categories', label: 'Категории' }],
    row: (d) => ({
      name: s(d.name), section: s(d.section), parentId: d.parentId ? String(d.parentId) : '', categories: s(d.categories), allCategories: d.allCategories === true,
      order: d.order ?? 0, required: d.required === true, isDefault: d.isDefault === true, installTypeId: d.installTypeId ? String(d.installTypeId) : '', slot: d.slot ?? '', text: String(d.text ?? ''),
    }),
    // запрет дублей — среди соседей (одно название под разными разделами допустимо)
    dupKey: (d) => `${d.parentId ? String(d.parentId) : ''}|${s(d.name).toLowerCase()}`,
    toDoc: async (b, isNew, db, id) => {
      const all = await loadNodes(db);
      const cur = id ? all.find((n) => n.id === id) : undefined;
      const others = all.filter((n) => n.id !== id);
      const has = (k: string) => b[k] !== undefined;
      let parentId: string | null = cur?.parentId ?? null;
      if (has('parentId')) {
        const raw = s(b.parentId);
        if (raw && !isOid(raw)) throw new BadRequestException('Некорректный родитель');
        parentId = raw || null;
      }
      const text = has('text') ? String(b.text ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim() : cur?.text ?? '';
      if (isNew && !parentId && text) throw new BadRequestException('Раздел — это вопрос без текста: текст пишется в вариантах под ним');
      const isDefault = has('isDefault') ? yes(b.isDefault) : cur?.isDefault ?? false;
      const err = checkNode(others, { id, parentId, text, isDefault });
      if (err) throw new BadRequestException(err);
      // раздел: у корня — из формы, у вариантов — раздел корня (для старых запросов и «Используется»)
      let section = has('section') ? s(b.section) : cur?.section ?? '';
      if (parentId) section = others.find((n) => n.id === rootOf(others, parentId!))?.section ?? section;
      else if (!section) throw new BadRequestException('Укажите раздел паспорта (Назначение, Установка…)');
      if (section && !SECTION_RE.test(section)) throw new BadRequestException('Раздел: латинские буквы, цифры и «-» (purpose, installation, mounting…)');
      const installTypeId = has('installTypeId') ? s(b.installTypeId) : cur?.installTypeId ?? '';
      if (installTypeId && !isOid(installTypeId)) throw new BadRequestException('Некорректный способ установки');
      const order = has('order') && s(b.order) !== '' ? Number(String(b.order).replace(',', '.')) : cur?.order ?? 0;
      if (!Number.isFinite(order)) throw new BadRequestException('Порядок — число');
      const slot = has('slot') && s(b.slot) !== '' ? Math.floor(Number(b.slot)) : cur?.slot ?? 1;
      if (!Number.isFinite(slot) || slot < 1) throw new BadRequestException('Номер пункта — число от 1');
      return {
        ...(isNew ? { dict: 'passportPhrases', deletedAt: null, createdAt: new Date() } : {}),
        name: s(b.name), section, parentId: parentId ? new Types.ObjectId(parentId) : null, text: text || null,
        categories: has('categories') ? s(b.categories) || null : cur?.categories || null,
        allCategories: has('allCategories') ? (yes(b.allCategories) ? true : null) : cur?.allCategories ? true : null,
        order, isDefault: isDefault ? true : null,
        required: !parentId && (has('required') ? yes(b.required) : cur?.required ?? false) ? true : null,
        slot: parentId ? null : slot,
        installTypeId: installTypeId ? new Types.ObjectId(installTypeId) : null,
        funnelV: 1, updatedAt: new Date(),
      };
    },
    beforeRemove: async (db, d) => {
      if (await db.collection('dict_values').countDocuments({ dict: 'passportPhrases', deletedAt: null, parentId: d._id })) {
        throw new ConflictException(`У «${s(d.name)}» есть варианты — сначала уберите варианты`);
      }
    },
    // «Используется»: выборы воронки в паспортах (textChoices) и изделиях (passportDefaults.textChoices) + старое сравнение по тексту
    usage: async (db, docs) => {
      const all = await loadNodes(db);
      const out = new Map<string, number>();
      const tally = new Map<string, Map<string, number>>(); // rootId → leafId → число
      const countBy = async (coll: string, path: string, root: string, extra: Record<string, unknown>) => {
        const rows = await db.collection(coll).aggregate([{ $match: { deletedAt: null, ...extra, [path]: { $nin: [null, ''] } } }, { $group: { _id: '$' + path, n: { $sum: 1 } } }]).toArray();
        const m = tally.get(root) ?? new Map<string, number>();
        for (const r of rows) m.set(String(r._id), (m.get(String(r._id)) ?? 0) + (r.n as number));
        tally.set(root, m);
      };
      for (const root of new Set(docs.map((d) => rootOf(all, String(d._id))).filter((x): x is string => !!x))) {
        await countBy('productpassports', `textChoices.${root}`, root, {});
        await countBy('products', `passportDefaults.textChoices.${root}`, root, {});
      }
      for (const d of docs) {
        const id = String(d._id);
        const m = tally.get(rootOf(all, id) ?? '');
        let n = 0;
        for (const l of leafIdsOf(all, d)) n += m?.get(l) ?? 0;
        const text = s(d.text);
        if (text) n += await db.collection('productpassports').countDocuments({ deletedAt: null, [legacyField(d)]: text });
        out.set(id, n);
      }
      return out;
    },
    related: async (db, d) => {
      const all = await loadNodes(db);
      const root = rootOf(all, String(d._id));
      const ids = leafIdsOf(all, d);
      const none = { _id: new Types.ObjectId('000000000000000000000000'), deletedAt: null };
      const pq: Record<string, unknown> = root ? { deletedAt: null, [`textChoices.${root}`]: { $in: ids } } : none;
      const gq: Record<string, unknown> = root ? { deletedAt: null, [`passportDefaults.textChoices.${root}`]: { $in: ids } } : none;
      const [pp, ppTotal, pr, prTotal] = await Promise.all([
        db.collection('productpassports').find(pq).sort({ _id: -1 }).limit(15).project({ passportNumber: 1, name: 1, status: 1 }).toArray(),
        db.collection('productpassports').countDocuments(pq),
        db.collection('products').find(gq).sort({ _id: -1 }).limit(15).project({ name: 1, sku: 1 }).toArray(),
        db.collection('products').countDocuments(gq),
      ]);
      const legacy = s(d.text) ? await base.related(db, d) : { total: 0, items: [] as { label: string; href?: string }[] };
      return {
        title: 'Паспорта и изделия с этим выбором', total: ppTotal + prTotal + legacy.total,
        items: [
          ...pp.map((p) => ({ label: `Паспорт № ${p.status === 'draft' ? '— (черновик)' : s(p.passportNumber)} ${s(p.name)}`, href: '#passports?of=passports&open=' + String(p._id) })),
          ...pr.map((p) => ({ label: `Изделие ${s(p.name)}`, sub: s(p.sku), href: '#products?open=' + String(p._id) })),
          ...legacy.items,
        ],
      };
    },
    // объединение: черновики паспортов и изделия переходят на вариант, с которым объединяют; выданные хранят свой снимок текста
    reassign: async (db, from, to) => {
      const all = await loadNodes(db);
      const root = rootOf(all, String(from._id));
      const leaf = (d: Doc) => !all.some((n) => n.parentId === String(d._id));
      if (!root || root !== rootOf(all, String(to._id)) || !leaf(from) || !leaf(to)) return 0;
      const a = String(from._id), b = String(to._id);
      const p = await db.collection('productpassports').updateMany({ status: 'draft', [`textChoices.${root}`]: a }, { $set: { [`textChoices.${root}`]: b, updatedAt: new Date() } });
      const g = await db.collection('products').updateMany({ [`passportDefaults.textChoices.${root}`]: a }, { $set: { [`passportDefaults.textChoices.${root}`]: b, updatedAt: new Date() } });
      return p.modifiedCount + g.modifiedCount;
    },
  };
}
