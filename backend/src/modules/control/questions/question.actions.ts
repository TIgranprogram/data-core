import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { mongo } from 'mongoose';
import { DICT } from '../../dicts/dicts.defs';
import type { DictsService } from '../../dicts/dicts.service';
import type { PartnersService } from '../../partners/partners.service';
import { plural as q, TOUCHED_MAX } from './question.rules';
import type { ActionDef, PreviewResult, Touched } from './question.types';

type Db = mongo.Db;
const oid = (s: unknown) => new Types.ObjectId(String(s));

export interface ActionDeps {
  db: Db;
  partners: Pick<PartnersService, 'merge' | 'restore'>;
  dicts: Pick<DictsService, 'merge' | 'restore' | 'usage'>;
}

/** Связанные с контрагентом коллекции, которые переносит слияние (см. PartnersService.merge). */
const MERGE_COLLS: Array<[string, [string, string, string]]> = [
  ['supplyrequests', ['заявка на снабжение', 'заявки на снабжение', 'заявок на снабжение']],
  ['supplyinvoices', ['счёт', 'счёта', 'счетов']],
  ['suppliercontracts', ['договор', 'договора', 'договоров']],
  ['supplieritems', ['позиция каталога', 'позиции каталога', 'позиций каталога']],
];

function guardSize(touched: Touched[]) {
  const total = touched.reduce((s, t) => s + t.ids.length, 0);
  if (total > TOUCHED_MAX) throw new ConflictException(`Затронуто слишком много записей (${total}): объединяйте вручную в карточке контрагента`);
}

async function liveOrg(db: Db, id: string) {
  const o = await db.collection('organizations').findOne({ _id: oid(id), deletedAt: null });
  if (!o) throw new NotFoundException('Контрагент не найден (возможно, уже объединён или удалён)');
  return o;
}

/** Три готовых действия «Разбора» (CC-15). Исполнение — существующие сервисы, логика не копируется. */
export function buildActions(d: ActionDeps): ActionDef[] {
  const mergePartners: ActionDef = {
    id: 'partners.merge',
    paramsSchema: { fromId: 'oid', intoId: 'oid' },
    roles: ['admin'],
    risk: 'reversible',
    async preview(p): Promise<PreviewResult> {
      const fromId = String(p.fromId), intoId = String(p.intoId);
      if (fromId === intoId) throw new BadRequestException('Нельзя объединить контрагента с самим собой');
      const [a, b] = await Promise.all([liveOrg(d.db, fromId), liveOrg(d.db, intoId)]);
      if (a.isOurCompany || b.isOurCompany) throw new BadRequestException('Наши компании не объединяются');
      const touched: Touched[] = [{ coll: 'organizations', ids: [oid(fromId), oid(intoId)] }];
      const lines = [`Контрагент «${a.name}» будет объединён с «${b.name}»; «${a.name}» уйдёт в корзину.`];
      const counts: Record<string, string[]> = {};
      for (const [coll, forms] of MERGE_COLLS) {
        const ids = (await d.db.collection(coll).find({ supplierId: oid(fromId) }, { projection: { _id: 1 } }).toArray()).map((x) => x._id as Types.ObjectId);
        counts[coll] = ids.map(String).sort();
        if (ids.length) { touched.push({ coll, ids }); lines.push(`Перейдёт к «${b.name}»: ${q(ids.length, forms)}.`); }
      }
      if (lines.length === 1) lines.push('Связанных записей нет: переносить нечего.');
      guardSize(touched);
      lines.push('Отменить можно, пока эти записи никто не менял.');
      return { lines, plan: { fromId, intoId, from: [a.name, a.inn], into: b.name, counts }, touched };
    },
    async execute(p) {
      const r = await d.partners.merge(String(p.fromId), String(p.intoId));
      return { message: `Объединено. Перенесено заявок: ${(r as { moved?: number }).moved ?? 0}.` };
    },
  };

  const dictOf = (key: unknown) => {
    const def = DICT.get(String(key));
    if (!def) throw new NotFoundException('Нет такого справочника');
    return def;
  };
  const dictDoc = async (def: ReturnType<typeof dictOf>, id: string, deleted = false) => {
    const f = deleted ? { _id: oid(id), deletedAt: { $ne: null } } : { ...def.match, _id: oid(id) };
    const doc = await d.db.collection(def.coll).findOne(f as never);
    if (!doc) throw new NotFoundException(deleted ? 'В корзине такого значения нет' : 'Значение справочника не найдено (возможно, уже удалено)');
    return doc;
  };

  const mergeDict: ActionDef = {
    id: 'dicts.merge',
    paramsSchema: { dict: 'string', fromId: 'oid', intoId: 'oid' },
    roles: ['admin'],
    risk: 'irreversible',
    async preview(p): Promise<PreviewResult> {
      const def = dictOf(p.dict);
      const fromId = String(p.fromId), intoId = String(p.intoId);
      if (fromId === intoId) throw new BadRequestException('Нельзя объединить значение с самим собой');
      const [a, b] = await Promise.all([dictDoc(def, fromId), dictDoc(def, intoId)]);
      const use = await d.dicts.usage(def.key, fromId);
      if (use.locked) throw new ConflictException(`«${def.name(a as never)}» — ${String(use.locked).toLowerCase()}: объединить нельзя`);
      const lines = [`В справочнике «${def.title}» значение «${def.name(a as never)}» будет объединено с «${def.name(b as never)}».`];
      lines.push(use.busy ? `Записи, где оно используется (${use.sections.join(', ') || 'разделы приложения'}), перейдут к «${def.name(b as never)}».` : 'Нигде не используется: перенос записей не нужен.');
      lines.push('Исходное значение уйдёт в корзину. Отменить это действие кнопкой нельзя.');
      return { lines, plan: { dict: def.key, fromId, intoId, busy: use.busy, sections: use.sections } };
    },
    async execute(p, ctx) {
      const r = await d.dicts.merge(String(p.dict), String(p.fromId), String(p.intoId), ctx.actor);
      return { message: `Объединено. Перенесено записей: ${(r as { moved?: number }).moved ?? 0}.` };
    },
  };

  const restorePartner: ActionDef = {
    id: 'partners.restore',
    paramsSchema: { id: 'oid' },
    roles: ['admin'],
    risk: 'reversible',
    async preview(p): Promise<PreviewResult> {
      const o = await d.db.collection('organizations').findOne({ _id: oid(p.id), deletedAt: { $ne: null }, mergedInto: { $exists: false } });
      if (!o) throw new NotFoundException('В корзине такого контрагента нет (или он объединён с другим)');
      return { lines: [`Контрагент «${o.name}» вернётся из корзины в общий список.`, 'Отменить можно, пока запись никто не менял.'], plan: { id: String(p.id), name: o.name, deletedAt: o.deletedAt }, touched: [{ coll: 'organizations', ids: [oid(p.id)] }] };
    },
    async execute(p) {
      await d.partners.restore(String(p.id));
      return { message: 'Контрагент возвращён из корзины.' };
    },
  };

  const restoreDict: ActionDef = {
    id: 'dicts.restore',
    paramsSchema: { dict: 'string', id: 'oid' },
    roles: ['admin'],
    risk: 'reversible',
    async preview(p): Promise<PreviewResult> {
      const def = dictOf(p.dict);
      const doc = await dictDoc(def, String(p.id), true);
      if (doc.mergedInto) throw new ConflictException('Значение объединено с другим: вернуть его нельзя');
      return { lines: [`Значение «${def.name(doc as never)}» вернётся в справочник «${def.title}».`, 'Отменить можно, пока запись никто не менял.'], plan: { dict: def.key, id: String(p.id), deletedAt: doc.deletedAt }, touched: [{ coll: def.coll, ids: [oid(p.id)] }] };
    },
    async execute(p) {
      await d.dicts.restore(String(p.dict), String(p.id));
      return { message: 'Значение возвращено в справочник.' };
    },
  };

  return [mergePartners, mergeDict, restorePartner, restoreDict];
}
