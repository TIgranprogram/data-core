import { Types } from 'mongoose';
import { DICT } from '../../dicts/dicts.defs';
import { buildActions, type ActionDeps } from './question.actions';
import { ControlRegistry } from './question.registry';
import { hashOf, normName } from './question.rules';
import type { QOption } from './question.types';

const oids = (ids: string[]) => ids.filter((x) => /^[0-9a-f]{24}$/i.test(x)).map((x) => new Types.ObjectId(x));
const str = (v: unknown) => String(v ?? '');

export interface KindDeps extends ActionDeps {
  /** Итог fill-audit: сколько записей требуют заполнения и какие группы. */
  fillSummary: () => Promise<{ total: number; keys: string[] }>;
}

const go = (section: string, id?: string): QOption => ({ code: 'open', label: 'Открыть и посмотреть', risk: 'safe', link: { section, ...(id ? { id } : {}) } });

/** Реестр типов и действий. Вызывается один раз при старте; ошибка в реестре роняет запуск, а не первое нажатие. */
export function buildRegistry(d: KindDeps): ControlRegistry {
  const reg = new ControlRegistry();
  for (const a of buildActions(d)) reg.addAction(a);
  const admin = ['admin'];
  const gone = (alive: boolean, evidence = '') => ({ still: alive, evidence });
  const aliveOrgs = async (ids: string[]) => d.db.collection('organizations').countDocuments({ _id: { $in: oids(ids) }, deletedAt: null });

  // ── Типы с готовыми кнопками записи (CC-15): вопрос присылает ИИ или скрипт с ПК, сервер проверяет и считает предпросмотр ──
  reg.addType({
    type: 'merge_partners', title: 'Слить двух контрагентов', ruleV: 1, dueDays: 14, severity: 'medium', roles: admin, external: true,
    subjectFor: (p) => ({ kind: 'partner', ids: [str(p.fromId), str(p.intoId)] }),
    recheck: async (q) => gone((await aliveOrgs(q.subject.ids)) === 2, hashOf(q.subject.ids)),
    options: (q) => [
      { code: 'merge', label: 'Объединить', actionId: 'partners.merge', params: { fromId: str(q.params?.fromId), intoId: str(q.params?.intoId) }, risk: 'reversible' },
      go('partners', str(q.params?.intoId)),
    ],
  });
  reg.addType({
    type: 'merge_dict_values', title: 'Слить значения справочника', ruleV: 1, dueDays: 14, severity: 'medium', roles: admin, external: true,
    subjectFor: (p) => ({ kind: `dict:${str(p.dict)}`, ids: [str(p.fromId), str(p.intoId)] }),
    recheck: async (q) => {
      const def = DICT.get(str(q.params?.dict));
      if (!def) return gone(false);
      const n = await d.db.collection(def.coll).countDocuments({ ...def.match, _id: { $in: oids(q.subject.ids) } } as never);
      return gone(n === 2, hashOf(q.subject.ids));
    },
    options: (q) => [
      { code: 'merge', label: 'Объединить', actionId: 'dicts.merge', params: { dict: str(q.params?.dict), fromId: str(q.params?.fromId), intoId: str(q.params?.intoId) }, risk: 'irreversible' },
      go('dicts'),
    ],
  });
  reg.addType({
    type: 'restore_trash', title: 'Вернуть из корзины', ruleV: 1, dueDays: 14, severity: 'low', roles: admin, external: true,
    subjectFor: (p) => ({ kind: p.target === 'dict' ? `trash:dict:${str(p.dict)}` : 'trash:partner', ids: [str(p.id)] }),
    recheck: async (q) => {
      const id = oids(q.subject.ids)[0];
      if (!id) return gone(false);
      const coll = q.params?.target === 'dict' ? DICT.get(str(q.params?.dict))?.coll : 'organizations';
      if (!coll) return gone(false);
      const n = await d.db.collection(coll).countDocuments({ _id: id, deletedAt: { $ne: null }, mergedInto: { $exists: false } });
      return gone(n === 1, hashOf(q.subject.ids));
    },
    options: (q) => (q.params?.target === 'dict'
      ? [{ code: 'restore', label: 'Вернуть из корзины', actionId: 'dicts.restore', params: { dict: str(q.params?.dict), id: str(q.params?.id) }, risk: 'reversible' as const }]
      : [{ code: 'restore', label: 'Вернуть из корзины', actionId: 'partners.restore', params: { id: str(q.params?.id) }, risk: 'reversible' as const }]),
  });
  // Вопрос без кнопки записи: человек отвечает текстом или передаёт помощнику (ждёт 7 дней, потом вернётся)
  reg.addType({
    type: 'free_text', title: 'Вопрос с ответом текстом', ruleV: 1, dueDays: 14, severity: 'medium', roles: admin, external: true,
    recheck: async () => gone(true),
    options: () => [
      { code: 'reply', label: 'Ответить', risk: 'safe' },
      { code: 'to_agent', label: 'Передать помощнику', risk: 'safe' },
    ],
  });

  // ── Поставщики без кнопок записи (CC-16): только «Не проблема», «Отложить» или переход в раздел ──
  reg.addType({
    type: 'fill_audit', title: 'Данные требуют заполнения', ruleV: 1, dueDays: 7, severity: 'medium', roles: admin, external: false,
    recheck: async () => { const s = await d.fillSummary(); return gone(s.total > 0, hashOf([...s.keys].sort())); },
    options: () => [go('fill')],
  });
  reg.addType({
    type: 'client_error', title: 'Новая ошибка на сайте', ruleV: 1, dueDays: 3, severity: 'high', roles: admin, external: false,
    recheck: async (q) => {
      const since = new Date(Date.now() - 7 * 86_400_000);
      return gone((await d.db.collection('clienterrors').countDocuments({ sig: q.subject.ids[0], createdAt: { $gte: since } })) > 0, q.subject.ids[0]);
    },
    options: () => [],
  });
  reg.addType({
    type: 'dup_partners', title: 'Похожие контрагенты', ruleV: 1, dueDays: 14, severity: 'low', roles: admin, external: false,
    recheck: async (q) => {
      const rows = await d.db.collection('organizations').find({ _id: { $in: oids(q.subject.ids) }, deletedAt: null }, { projection: { name: 1 } }).toArray();
      return gone(rows.length >= 2 && new Set(rows.map((r) => normName(r.name))).size === 1, hashOf(q.subject.ids));
    },
    options: () => [go('partners')],
  });
  reg.addType({
    type: 'dup_dicts', title: 'Повторы в справочнике', ruleV: 1, dueDays: 14, severity: 'low', roles: admin, external: false,
    recheck: async (q) => {
      const def = DICT.get(q.subject.kind.replace(/^dict:/, ''));
      if (!def) return gone(false);
      const rows = await d.db.collection(def.coll).find({ ...def.match, _id: { $in: oids(q.subject.ids) } } as never).toArray();
      return gone(rows.length >= 2 && new Set(rows.map((r) => normName(def.name(r as never)))).size === 1, hashOf(q.subject.ids));
    },
    options: () => [go('dicts')],
  });
  // Сводный вопрос: источник прислал больше, чем можно показать
  reg.addType({
    type: 'overflow', title: 'Слишком много вопросов', ruleV: 1, dueDays: 7, severity: 'low', roles: admin, external: false,
    recheck: async () => gone(true),
    options: () => [],
  });

  reg.assertConsistent();
  return reg;
}
