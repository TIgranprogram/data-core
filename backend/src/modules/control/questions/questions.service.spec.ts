/* eslint-disable @typescript-eslint/no-explicit-any */
import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FakeDb } from './fake-db.testkit';
import { DAY, NEW_PER_SOURCE_PER_DAY, OPEN_MAX } from './question.rules';
import { QuestionsService } from './questions.service';

const ADMIN = { id: 'u1', role: 'admin', name: 'admin' };
const oid = () => new Types.ObjectId();
const NOW = new Date('2026-11-01T12:00:00Z');
const later = (days: number) => new Date(NOW.getTime() + days * DAY);

function harness() {
  const db = new FakeDb();
  const a = oid(), b = oid();
  db.seed('organizations', [
    { _id: a, name: 'Ромашка ООО', inn: '111', deletedAt: null },
    { _id: b, name: 'Ромашка', inn: '222', deletedAt: null },
  ]);
  db.seed('supplyrequests', [{ _id: oid(), supplierId: a, title: 'заявка 1' }, { _id: oid(), supplierId: a, title: 'заявка 2' }]);
  const partners = {
    merge: jest.fn(async (from: string, to: string) => {
      for (const r of db.collection('supplyrequests').rows) if (String(r.supplierId) === from) r.supplierId = new Types.ObjectId(to);
      const o = db.collection('organizations').rows.find((x) => String(x._id) === from)!;
      o.deletedAt = new Date(); o.mergedInto = new Types.ObjectId(to);
      return { moved: 2 };
    }),
    restore: jest.fn(async () => ({})),
  };
  const dicts = { merge: jest.fn(async () => ({ moved: 3 })), restore: jest.fn(async () => ({})), usage: jest.fn(async () => ({ busy: true, sections: ['заявки'], locked: null })) };
  const fill = { report: jest.fn(async () => ({ total: 5, groups: [{ key: 'g1', title: 'Заявки без категории', count: 5 }] })) };
  const errors = { top: jest.fn(async () => ({ items: [] as any[] })) };
  const svc = new QuestionsService({ db } as never, partners as never, dicts as never, fill as never, errors as never);
  return { db, svc, a, b, partners, dicts, fill, errors, qs: () => db.collection('app_control_questions').rows, ev: () => db.collection('app_control_events').rows };
}

const mergeDto = (h: ReturnType<typeof harness>) => ({ type: 'merge_partners', sourceName: 'помощник', params: { fromId: String(h.a), intoId: String(h.b) } });
async function askMerge(h: ReturnType<typeof harness>) {
  const r = await h.svc.create(mergeDto(h), ADMIN, NOW);
  return r.id;
}
async function confirm(h: ReturnType<typeof harness>, id: string, code = 'merge') {
  const pv = await h.svc.preview(id, { optionCode: code });
  return h.svc.answer(id, { optionCode: code, planHash: pv.planHash }, ADMIN, NOW);
}

describe('CC-14: реестр', () => {
  it('тип без recheck не регистрируется', () => {
    const { svc } = harness();
    expect(() => svc.reg.addType({ type: 'x', title: 'x', ruleV: 1, dueDays: 1, severity: 'low', roles: [], external: false, options: () => [] } as never)).toThrow(/без recheck/);
  });
  it('кнопка с неизвестным действием не проходит проверку реестра', () => {
    const { svc } = harness();
    svc.reg.addType({ type: 'bad', title: 'x', ruleV: 1, dueDays: 1, severity: 'low', roles: [], external: false, recheck: async () => ({ still: true }), options: () => [{ code: 'go', label: 'x', actionId: 'нет.такого', risk: 'safe' }] });
    expect(() => svc.reg.assertConsistent()).toThrow(/неизвестное действие/);
  });
  it('POST принимает только внешние типы', async () => {
    const { svc } = harness();
    await expect(svc.create({ type: 'overflow' } as never, ADMIN, NOW)).rejects.toThrow(/Такого типа/);
    await expect(svc.create({ type: 'fill_audit' } as never, ADMIN, NOW)).rejects.toThrow(/Такого типа/);
  });
});

describe('CC-14: постановка и дедупликация', () => {
  it('вопрос о слиянии: тексты по-русски, кнопки из реестра, параметры хранит сервер', async () => {
    const h = harness();
    const id = await askMerge(h);
    const q = await h.svc.get(id);
    expect(q.what).toContain('Ромашка ООО');
    expect(q.what).not.toMatch(/partners\.merge|fromId/);
    expect(q.options.map((o) => o.code)).toEqual(['merge', 'open', 'dismiss', 'snooze']);
    expect(q.options[0]).toMatchObject({ actionId: 'partners.merge', risk: 'reversible', needsPreview: true });
    expect(q.status).toBe('open');
  });

  it('повтор того же вопроса — count++, а не второй вопрос', async () => {
    const h = harness();
    const id1 = await askMerge(h);
    const r2 = await h.svc.create(mergeDto(h), ADMIN, later(1));
    expect(r2).toMatchObject({ id: id1, created: false });
    expect(h.qs()).toHaveLength(1);
    expect(h.qs()[0].seen.count).toBe(2);
  });

  it('несуществующий контрагент — 404 понятным текстом, вопрос не создан', async () => {
    const h = harness();
    await expect(h.svc.create({ type: 'merge_partners', params: { fromId: String(oid()), intoId: String(h.b) } }, ADMIN, NOW)).rejects.toThrow(/не найден/);
    expect(h.qs()).toHaveLength(0);
  });

  it('лимит: 20 новых в сутки на источник, дальше — один сводный вопрос со счётчиком', async () => {
    const h = harness();
    for (let i = 0; i < NEW_PER_SOURCE_PER_DAY; i++) expect((await h.svc.create({ type: 'free_text', what: `Вопрос ${i}`, sourceName: 'ИИ' }, ADMIN, NOW)).overflow).toBe(false);
    const r1 = await h.svc.create({ type: 'free_text', what: 'Лишний 1', sourceName: 'ИИ' }, ADMIN, NOW);
    const r2 = await h.svc.create({ type: 'free_text', what: 'Лишний 2', sourceName: 'ИИ' }, ADMIN, NOW);
    expect(r1.overflow && r2.overflow).toBe(true);
    expect(r1.id).toBe(r2.id);
    expect(h.qs().filter((q) => q.type === 'overflow')).toHaveLength(1);
    expect(h.qs().find((q) => q.type === 'overflow')!.what).toContain('2 вопроса');
    // другой источник не затронут
    expect((await h.svc.create({ type: 'free_text', what: 'Свой', sourceName: 'Другой' }, ADMIN, NOW)).overflow).toBe(false);
    // повтор уже открытого вопроса лимитом не считается
    expect((await h.svc.create({ type: 'free_text', what: 'Вопрос 0', sourceName: 'ИИ' }, ADMIN, NOW)).overflow).toBe(false);
  });

  it('лимит: 200 открытых всего — дальше сводный', async () => {
    const h = harness();
    for (let i = 0; i < OPEN_MAX; i++) h.qs().push({ _id: oid(), key: `k${i}`, active: true, type: 'free_text', status: 'open', source: { name: `s${i}` }, seen: { first: new Date(NOW.getTime() - 5 * DAY), last: NOW, count: 1 } });
    const r = await h.svc.create({ type: 'free_text', what: 'Ещё один', sourceName: 'новый' }, ADMIN, NOW);
    expect(r.overflow).toBe(true);
  });

  it('free_text без текста — 400', async () => {
    const h = harness();
    await expect(h.svc.create({ type: 'free_text' }, ADMIN, NOW)).rejects.toThrow(/Напишите вопрос/);
  });
});

describe('CC-14: предпросмотр, хеш плана, исполнение', () => {
  it('предпросмотр считает, что изменится, и хеш плана', async () => {
    const h = harness();
    const id = await askMerge(h);
    const pv = await h.svc.preview(id, { optionCode: 'merge' });
    expect(pv.lines.join(' ')).toContain('заявки на снабжение');
    expect(pv).toMatchObject({ risk: 'reversible', reversible: true });
    expect(pv.planHash).toMatch(/^[0-9a-f]{16}$/);
    expect((await h.svc.preview(id, {})).planHash).toBe(pv.planHash); // код по умолчанию — первое действие
    expect(h.partners.merge).not.toHaveBeenCalled(); // предпросмотр ничего не пишет
  });

  it('без хеша плана действие не выполняется', async () => {
    const h = harness();
    const id = await askMerge(h);
    await expect(h.svc.answer(id, { optionCode: 'merge' }, ADMIN, NOW)).rejects.toThrow(/предпросмотр/);
    expect(h.partners.merge).not.toHaveBeenCalled();
  });

  it('данные изменились после предпросмотра — 409 с новым предпросмотром, запись не выполнена', async () => {
    const h = harness();
    const id = await askMerge(h);
    const pv = await h.svc.preview(id, { optionCode: 'merge' });
    h.db.collection('supplyrequests').rows.push({ _id: oid(), supplierId: h.a, title: 'новая заявка' });
    const err: any = await h.svc.answer(id, { optionCode: 'merge', planHash: pv.planHash }, ADMIN, NOW).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse().preview.planHash).not.toBe(pv.planHash);
    expect(h.partners.merge).not.toHaveBeenCalled();
    expect((await h.svc.get(id)).status).toBe('open');
  });

  it('успех: открыт → выполняется → готово; журнал и снимок для отката записаны', async () => {
    const h = harness();
    const id = await askMerge(h);
    const q = await confirm(h, id);
    expect(q.status).toBe('done');
    expect(q.canUndo).toBe(true);
    expect(h.partners.merge).toHaveBeenCalledWith(String(h.a), String(h.b));
    expect(h.ev().map((e) => e.kind)).toEqual(['created', 'executing', 'done']);
    expect(h.qs()[0].active).toBe(false);
  });

  it('двойное нажатие: действие исполняется один раз', async () => {
    const h = harness();
    const id = await askMerge(h);
    const pv = await h.svc.preview(id, { optionCode: 'merge' });
    const res = await Promise.allSettled([
      h.svc.answer(id, { optionCode: 'merge', planHash: pv.planHash }, ADMIN, NOW),
      h.svc.answer(id, { optionCode: 'merge', planHash: pv.planHash }, ADMIN, NOW),
    ]);
    expect(h.partners.merge).toHaveBeenCalledTimes(1);
    expect(res.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });

  it('сбой: статус «не вышло», понятный текст, журнал; повтор только руками', async () => {
    const h = harness();
    h.partners.merge.mockRejectedValueOnce(new ConflictException('Объединить нельзя: совпадают номера договоров'));
    const id = await askMerge(h);
    const q = await confirm(h, id);
    expect(q.status).toBe('failed');
    expect(q.exec!.error).toContain('номера договоров');
    expect(h.ev().at(-1)).toMatchObject({ kind: 'failed' });
    expect(q.canUndo).toBe(false);
    expect(h.db.collection('app_control_undo').rows).toHaveLength(0); // снимок неудачной попытки не копится
    const again = await confirm(h, id); // рукой, с новым предпросмотром
    expect(again.status).toBe('done');
    expect(again.exec!.attempts).toBe(2);
  });

  it('неизвестная ошибка не показывает служебный текст', async () => {
    const h = harness();
    h.partners.merge.mockRejectedValueOnce(new Error('MongoServerError: E11000 secret'));
    const q = await confirm(h, await askMerge(h));
    expect(q.exec!.error).toMatch(/Не удалось выполнить/);
    expect(q.exec!.error).not.toContain('Mongo');
  });

  it('recheck перед исполнением: проблема ушла сама — ничего не пишем, вопрос закрыт', async () => {
    const h = harness();
    const id = await askMerge(h);
    const pv = await h.svc.preview(id, { optionCode: 'merge' });
    h.db.collection('organizations').rows[0].deletedAt = new Date(); // кто-то уже убрал дубль
    const q = await h.svc.answer(id, { optionCode: 'merge', planHash: pv.planHash }, ADMIN, NOW);
    expect(q.status).toBe('resolved_auto');
    expect(h.partners.merge).not.toHaveBeenCalled();
  });

  it('действие только для админа', async () => {
    const h = harness();
    const id = await askMerge(h);
    const pv = await h.svc.preview(id, { optionCode: 'merge' });
    await expect(h.svc.answer(id, { optionCode: 'merge', planHash: pv.planHash }, { id: 'u2', role: 'manager' }, NOW)).rejects.toThrow(/администратору/);
  });

  it('слияние значения справочника: необратимо, снимка нет, пишет существующий сервис', async () => {
    const h = harness();
    const { DICTS } = await import('../../dicts/dicts.defs');
    const def = DICTS[0];
    const x = oid(), y = oid();
    const base = { ...def.match, name: 'А', title: 'А', label: 'А' };
    h.db.seed(def.coll, [{ ...base, _id: x }, { ...base, _id: y, name: 'Б', title: 'Б', label: 'Б' }]);
    const { id } = await h.svc.create({ type: 'merge_dict_values', params: { dict: def.key, fromId: String(x), intoId: String(y) } }, ADMIN, NOW);
    const pv = await h.svc.preview(id, { optionCode: 'merge' });
    expect(pv).toMatchObject({ risk: 'irreversible', reversible: false });
    expect(pv.lines.join(' ')).toContain('нельзя');
    const q = await h.svc.answer(id, { optionCode: 'merge', planHash: pv.planHash }, ADMIN, NOW);
    expect(q.status).toBe('done');
    expect(q.canUndo).toBe(false);
    expect(h.dicts.merge).toHaveBeenCalledWith(def.key, String(x), String(y), expect.objectContaining({ role: 'admin' }));
  });

  it('вернуть из корзины: вызывает restore контрагентов', async () => {
    const h = harness();
    h.db.collection('organizations').rows[0].deletedAt = new Date();
    const { id } = await h.svc.create({ type: 'restore_trash', params: { target: 'partner', id: String(h.a) } }, ADMIN, NOW);
    const q = await confirm(h, id, 'restore');
    expect(q.status).toBe('done');
    expect(h.partners.restore).toHaveBeenCalledWith(String(h.a));
  });
});

describe('CC-14: откат', () => {
  it('откат возвращает записи как были; второй раз — отказ', async () => {
    const h = harness();
    const id = await askMerge(h);
    await confirm(h, id);
    expect(h.db.collection('supplyrequests').rows.every((r) => String(r.supplierId) === String(h.b))).toBe(true);
    const q = await h.svc.undo(id, ADMIN, NOW);
    expect(q.status).toBe('open');
    expect(h.db.collection('supplyrequests').rows.every((r) => String(r.supplierId) === String(h.a))).toBe(true);
    expect(h.db.collection('organizations').rows[0].deletedAt).toBeNull();
    await expect(h.svc.undo(id, ADMIN, NOW)).rejects.toThrow(/нет|отменено/);
    expect(h.ev().at(-1)).toMatchObject({ kind: 'undone' });
  });

  it('откат отказывает, если записи меняли после действия', async () => {
    const h = harness();
    const id = await askMerge(h);
    await confirm(h, id);
    h.db.collection('supplyrequests').rows[0].title = 'правка менеджера';
    await expect(h.svc.undo(id, ADMIN, NOW)).rejects.toThrow(/уже менялись/);
    expect(h.db.collection('supplyrequests').rows[0].title).toBe('правка менеджера'); // чужая правка не потеряна
    expect((await h.svc.get(id)).status).toBe('done');
  });

  it('откат невыполненного вопроса — отказ', async () => {
    const h = harness();
    await expect(h.svc.undo(await askMerge(h), ADMIN, NOW)).rejects.toThrow(/отката нет/);
  });
});

describe('CC-14: исходы цикла без действия', () => {
  it('«Не проблема» закрывает и запоминает данные; те же данные не возвращают вопрос, изменённые — возвращают', async () => {
    const h = harness();
    h.fill.report.mockResolvedValue({ total: 5, groups: [{ key: 'g1', title: 'Группа', count: 5 }] });
    await h.svc.daily(NOW);
    const q = h.qs().find((x) => x.type === 'fill_audit')!;
    expect(q.status).toBe('open');
    const done = await h.svc.answer(String(q._id), { optionCode: 'dismiss', comment: 'так и задумано' }, ADMIN, NOW);
    expect(done.status).toBe('dismissed');
    expect(done.active).toBe(false);
    await h.svc.daily(later(1));
    expect(h.qs().filter((x) => x.type === 'fill_audit')).toHaveLength(1);
    expect(h.qs().find((x) => x.type === 'fill_audit')!.status).toBe('dismissed');
    // появилась новая группа — данные изменились — вопрос вернулся
    h.fill.report.mockResolvedValue({ total: 8, groups: [{ key: 'g1', title: 'Группа', count: 5 }, { key: 'g2', title: 'Новая', count: 3 }] });
    await h.svc.daily(later(2));
    const back = h.qs().filter((x) => x.type === 'fill_audit');
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ status: 'open', active: true });
    expect(h.ev().some((e) => e.kind === 'reopened')).toBe(true);
  });

  it('«Отложить»: не больше двух раз, дата в будущем, просыпается в срок', async () => {
    const h = harness();
    const id = await askMerge(h);
    await expect(h.svc.answer(id, { optionCode: 'snooze' }, ADMIN, NOW)).rejects.toThrow(/дату в будущем/);
    await expect(h.svc.answer(id, { optionCode: 'snooze', snoozeUntil: '2020-01-01' }, ADMIN, NOW)).rejects.toThrow(/дату в будущем/);
    expect((await h.svc.answer(id, { optionCode: 'snooze', snoozeUntil: later(3).toISOString() }, ADMIN, NOW)).status).toBe('snoozed');
    await h.svc.housekeeping(later(1));
    expect((await h.svc.get(id)).status).toBe('snoozed');
    await h.svc.housekeeping(later(4));
    expect((await h.svc.get(id)).status).toBe('open');
    await h.svc.answer(id, { optionCode: 'snooze', snoozeUntil: later(10).toISOString() }, ADMIN, later(4));
    await h.svc.housekeeping(later(11));
    await expect(h.svc.answer(id, { optionCode: 'snooze', snoozeUntil: later(20).toISOString() }, ADMIN, later(11))).rejects.toThrow(/не больше 2/);
    expect((await h.svc.get(id)).status).toBe('open'); // выход остаётся: решить или «Не проблема»
  });

  it('ночная проверка: проблемы нет — «закрыт сам»', async () => {
    const h = harness();
    const id = await askMerge(h);
    h.db.collection('organizations').rows[1].deletedAt = new Date();
    await h.svc.daily(later(1));
    expect((await h.svc.get(id)).status).toBe('resolved_auto');
    expect(h.ev().at(-1)).toMatchObject({ kind: 'resolved_auto' });
  });

  it('текстовый ответ закрывает вопрос; без текста — 400', async () => {
    const h = harness();
    const { id } = await h.svc.create({ type: 'free_text', what: 'Какой НДС ставить?' }, ADMIN, NOW);
    await expect(h.svc.answer(id, { optionCode: 'reply' }, ADMIN, NOW)).rejects.toThrow(/Напишите ответ/);
    const q = await h.svc.answer(id, { optionCode: 'reply', comment: '20%' }, ADMIN, NOW);
    expect(q).toMatchObject({ status: 'done', decision: expect.objectContaining({ comment: '20%' }) });
  });

  it('«Передать помощнику»: ждёт 7 дней, потом возвращается человеку', async () => {
    const h = harness();
    const { id } = await h.svc.create({ type: 'free_text', what: 'Нужна проверка' }, ADMIN, NOW);
    expect((await h.svc.answer(id, { optionCode: 'to_agent' }, ADMIN, NOW)).status).toBe('waiting_agent');
    await h.svc.housekeeping(later(6));
    expect((await h.svc.get(id)).status).toBe('waiting_agent');
    await h.svc.housekeeping(later(8));
    expect((await h.svc.get(id)).status).toBe('open');
    expect(h.ev().at(-1)).toMatchObject({ kind: 'returned' });
  });

  it('истёк срок: просроченный вопрос поднимается выше; ИИ-вопрос без ответа 30 дней истекает, системный — никогда', async () => {
    const h = harness();
    const ai = await askMerge(h);
    const { id: txt } = await h.svc.create({ type: 'free_text', what: 'Старый вопрос' }, ADMIN, NOW);
    h.fill.report.mockResolvedValue({ total: 2, groups: [{ key: 'g', title: 'Г', count: 2 }] });
    await h.svc.daily(NOW);
    const r = await h.svc.daily(later(15)); // срок 14 дней вышел
    expect(r.escalated).toBeGreaterThanOrEqual(1);
    expect((await h.svc.get(ai)).severity).toBe('high');
    expect(h.svc.present(h.qs().find((x) => String(x._id) === ai) as never, later(15)).overdue).toBe(true);
    const list = await h.svc.list({});
    expect(list.items[0].severity).toBe('high');
    await h.svc.daily(later(31));
    expect((await h.svc.get(txt)).status).toBe('expired');
    expect((await h.svc.get(ai)).status).toBe('expired');
    expect(h.qs().find((x) => x.type === 'fill_audit')!.status).toBe('open');
  });

  it('зависшее «выполняется»: проблема ушла — готово, иначе — сбой', async () => {
    const h = harness();
    const id1 = await askMerge(h);
    const q1 = h.qs()[0];
    q1.status = 'executing'; q1.exec = { state: 'running', opId: 'x', leaseUntil: new Date(NOW.getTime() - 1000), attempts: 1 };
    await h.svc.housekeeping(NOW);
    expect((await h.svc.get(id1)).status).toBe('failed'); // дубль на месте — не сделано
    expect((await h.svc.get(id1)).exec!.error).toMatch(/не завершилось/);

    const h2 = harness();
    const id2 = await askMerge(h2);
    const q2 = h2.qs()[0];
    q2.status = 'executing'; q2.exec = { state: 'running', opId: 'x', leaseUntil: new Date(NOW.getTime() - 1000), attempts: 1 };
    h2.db.collection('organizations').rows[0].deletedAt = new Date(); // слияние успело пройти
    await h2.svc.housekeeping(NOW);
    expect((await h2.svc.get(id2)).status).toBe('done');
  });

  it('пока идёт выполнение, ответ отклоняется', async () => {
    const h = harness();
    const id = await askMerge(h);
    h.qs()[0].status = 'executing';
    await expect(h.svc.answer(id, { optionCode: 'dismiss' }, ADMIN, NOW)).rejects.toThrow(/уже выполняется/);
  });

  it('закрытый вопрос не принимает ответ; несуществующий ответ — 400', async () => {
    const h = harness();
    const id = await askMerge(h);
    await expect(h.svc.answer(id, { optionCode: 'нет' }, ADMIN, NOW)).rejects.toThrow(/нет такого ответа/);
    await h.svc.answer(id, { optionCode: 'dismiss' }, ADMIN, NOW);
    await expect(h.svc.answer(id, { optionCode: 'dismiss' }, ADMIN, NOW)).rejects.toThrow(/уже закрыт/);
  });
});

describe('CC-16: поставщики (только «Не проблема», «Отложить» или переход)', () => {
  it('итог заполнения — один сводный вопрос; повтор в тот же день счётчик не накручивает', async () => {
    const h = harness();
    await h.svc.daily(NOW);
    await h.svc.daily(new Date(NOW.getTime() + 3600_000));
    const q = h.qs().find((x) => x.type === 'fill_audit')!;
    expect(q.seen.count).toBe(1);
    expect(q.what).toContain('5 записей');
    expect(q.options.map((o: any) => o.code)).toEqual(['open', 'dismiss', 'snooze']);
    expect(q.options.some((o: any) => o.actionId)).toBe(false);
    await h.svc.daily(later(1));
    expect(h.qs().find((x) => x.type === 'fill_audit')!.seen.count).toBe(2);
  });

  it('всё заполнено — вопрос закрывается сам', async () => {
    const h = harness();
    await h.svc.daily(NOW);
    h.fill.report.mockResolvedValue({ total: 0, groups: [] });
    await h.svc.daily(later(1));
    expect(h.qs().find((x) => x.type === 'fill_audit')!.status).toBe('resolved_auto');
  });

  it('новая ошибка сайта — вопрос без служебных кодов; старая сигнатура не создаёт вопрос', async () => {
    const h = harness();
    h.db.seed('clienterrors', [{ _id: oid(), sig: 'old', createdAt: later(-5) }, { _id: oid(), sig: 'new1', createdAt: NOW }, { _id: oid(), sig: 'old', createdAt: NOW }]);
    h.errors.top.mockResolvedValue({ items: [
      { sig: 'old', count: 3, users: 1, message: 'старая', section: 'orders' },
      { sig: 'new1', count: 4, users: 2, message: 'Cannot read properties of undefined', section: 'stock' },
    ] });
    await h.svc.daily(NOW);
    const e = h.qs().filter((x) => x.type === 'client_error');
    expect(e).toHaveLength(1);
    expect(e[0].what).toContain('Cannot read properties');
    expect(e[0].what).toContain('раздел «stock»');
    expect(e[0].what).not.toContain('new1');
    expect(e[0].options.map((o: any) => o.code)).toEqual(['dismiss', 'snooze']);
  });

  it('дубли контрагентов: полное совпадение без регистра и лишних пробелов; нечёткого поиска нет', async () => {
    const h = harness();
    h.db.seed('organizations', [
      { _id: oid(), name: 'ООО  Лотос', deletedAt: null }, { _id: oid(), name: 'ооо лотос ', deletedAt: null },
      { _id: oid(), name: 'ООО Лотос-М', deletedAt: null }, { _id: oid(), name: 'Наша', isOurCompany: true, deletedAt: null }, { _id: oid(), name: 'наша', isOurCompany: true, deletedAt: null },
    ]);
    await h.svc.daily(NOW);
    const d = h.qs().filter((x) => x.type === 'dup_partners');
    expect(d).toHaveLength(1);
    expect(d[0].subject.ids).toHaveLength(2);
    expect(d[0].options.some((o: any) => o.actionId)).toBe(false);
  });

  it('GET: фильтры по статусу, важности и типу; счётчики по статусам', async () => {
    const h = harness();
    await askMerge(h);
    await h.svc.create({ type: 'free_text', what: 'Вопрос' }, ADMIN, NOW);
    expect((await h.svc.list({ type: 'free_text' })).total).toBe(1);
    expect((await h.svc.list({ status: 'open,failed' })).total).toBe(2);
    expect((await h.svc.list({ status: 'done' })).total).toBe(0);
    await expect(h.svc.list({ status: 'abc' })).rejects.toThrow(/Статус/);
    await expect(h.svc.list({ severity: 'x' })).rejects.toThrow(/Важность/);
    expect((await h.svc.list({})).counts).toEqual({ open: 2 });
  });

  it('журнал вопроса: кто и что', async () => {
    const h = harness();
    const id = await askMerge(h);
    await h.svc.answer(id, { optionCode: 'dismiss' }, ADMIN, NOW);
    const ev = await h.svc.events(id, {});
    expect(ev.items.map((e) => e.kind)).toEqual(['created', 'dismissed']);
    expect(ev.items[1].by).toBe('admin');
  });
});
