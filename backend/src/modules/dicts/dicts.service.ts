import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { Types } from 'mongoose';
import { DICT, DICTS, type DictDef, type Doc, norm } from './dicts.defs';

/** Сходство названий (биграммы, коэффициент Дайса) — «похоже на …» при переносе значений. */
function similarity(a: string, b: string) {
  const g = (t: string) => { const x = ` ${norm(t)} `; const m = new Map<string, number>(); for (let i = 0; i < x.length - 1; i++) { const k = x.slice(i, i + 2); m.set(k, (m.get(k) ?? 0) + 1); } return m; };
  const A = g(a), B = g(b); let both = 0, n = 0;
  for (const [k, v] of A) { both += Math.min(v, B.get(k) ?? 0); n += v; }
  for (const v of B.values()) n += v;
  return n ? (2 * both) / n : 0;
}

/**
 * «Справочники» (TASKS СП.4–СП.8): один раздел для всех выпадающих списков приложения.
 * Строка справочника — `<ключ справочника>:<ObjectId>`; описание справочников — `dicts.defs.ts`.
 */
@Injectable()
export class DictsService {
  constructor(@InjectConnection() private readonly connection: Connection) {}
  private get db() { return this.connection.db!; }

  private def(key: string): DictDef {
    const d = DICT.get(key);
    if (!d) throw new NotFoundException('Нет такого справочника');
    return d;
  }
  private oid(id: string) {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Некорректный id записи');
    return new Types.ObjectId(id);
  }
  private async docs(d: DictDef) {
    return (await this.db.collection(d.coll).find(d.match).toArray()) as Doc[];
  }
  private async one(d: DictDef, id: string) {
    const doc = (await this.db.collection(d.coll).findOne({ ...d.match, _id: this.oid(id) })) as Doc | null;
    if (!doc) throw new NotFoundException('Запись не найдена (возможно, удалена)');
    return doc;
  }
  private item(d: DictDef, doc: Doc, used = 0) {
    const id = String(doc._id);
    return { ...d.row(doc), id, _id: id, dict: d.key, used, updatedAt: doc.updatedAt ?? null };
  }

  /** Группы и справочники со счётчиками — левая колонка экрана. */
  async groups() {
    const out: { group: string; items: { key: string; title: string; hint: string; count: number }[] }[] = [];
    for (const d of DICTS) {
      const n = await this.db.collection(d.coll).countDocuments(d.match);
      let g = out.find((x) => x.group === d.group);
      if (!g) out.push((g = { group: d.group, items: [] }));
      g.items.push({ key: d.key, title: d.title, hint: d.hint, count: n });
    }
    return { items: out };
  }

  /** Строки справочника: названия, свои колонки, «используется в N». Поля формы — для правой панели. */
  async list(key: string, search?: string) {
    const d = this.def(key);
    const docs = await this.docs(d);
    const used = await d.usage(this.db, docs);
    const s = norm(search);
    // справочник для ссылок «Вид работ» / «График выплат» в форме
    const refs: Record<string, { value: string; label: string }[]> = {};
    for (const f of d.fields) if (f.ref) { const rd = this.def(f.ref); refs[f.ref] = (await this.docs(rd)).map((x) => ({ value: String(x._id), label: rd.name(x) })).sort((a, b) => a.label.localeCompare(b.label, 'ru')); }
    const items = docs.map((x) => this.item(d, x, used.get(String(x._id)) ?? 0) as Record<string, unknown>)
      .map((x) => ({ ...x, ...(x.workTypeId !== undefined ? { workTypeName: refs.worktypes?.find((r) => r.value === String(x.workTypeId))?.label ?? '' } : {}) }))
      .filter((x) => !s || norm(Object.values(x).join(' ')).includes(s))
      .sort((a, b) => String((a as { name?: unknown }).name).localeCompare(String((b as { name?: unknown }).name), 'ru'));
    return { items, total: items.length, page: 1, limit: items.length, dict: { key: d.key, title: d.title, group: d.group, hint: d.hint, columns: d.columns, fields: d.fields, refs } };
  }

  async get(key: string, id: string) {
    const d = this.def(key);
    const doc = await this.one(d, id);
    const used = (await d.usage(this.db, [doc])).get(id) ?? 0;
    const related = await d.related(this.db, doc);
    const base = (await this.list(key)).dict;
    const row = this.item(d, doc, used) as Record<string, unknown>;
    if (row.workTypeId !== undefined) row.workTypeName = base.refs.worktypes?.find((r) => r.value === row.workTypeId)?.label ?? '';
    if (row.payoutScheduleId !== undefined) row.payoutScheduleName = base.refs.payoutSchedules?.find((r) => r.value === row.payoutScheduleId)?.label ?? '';
    return { ...row, related, dictInfo: { title: d.title, fields: d.fields, refs: base.refs } };
  }

  private async checkDuplicate(d: DictDef, name: string, exceptId?: string) {
    const n = norm(name);
    if (!n) throw new BadRequestException('Укажите название');
    const dup = (await this.docs(d)).find((x) => norm(d.name(x)) === n && String(x._id) !== exceptId);
    if (dup) throw new ConflictException(`«${d.name(dup)}» уже есть в справочнике «${d.title}»`);
  }

  async create(key: string, body: Record<string, unknown>) {
    const d = this.def(key);
    const doc = await d.toDoc(body ?? {}, true, this.db);
    await this.checkDuplicate(d, d.name(doc as Doc));
    const r = await this.db.collection(d.coll).insertOne(doc);
    return this.get(key, String(r.insertedId));
  }

  async update(key: string, id: string, body: Record<string, unknown>) {
    const d = this.def(key);
    const cur = await this.one(d, id);
    const set = await d.toDoc(body ?? {}, false, this.db);
    await this.checkDuplicate(d, d.name({ ...cur, ...set } as Doc), id);
    await this.db.collection(d.coll).updateOne({ _id: cur._id }, { $set: set });
    return this.get(key, id);
  }

  /** Удалить (в корзину). Используемое значение удалить нельзя — только объединить с другим (СП.8). */
  async remove(key: string, id: string) {
    const d = this.def(key);
    const doc = await this.one(d, id);
    const used = (await d.usage(this.db, [doc])).get(id) ?? 0;
    if (used > 0) throw new ConflictException(`«${d.name(doc)}» используется в записях: ${used}. Удалить нельзя — объедините с другим значением («Объединить с…»), записи перейдут к нему.`);
    await this.db.collection(d.coll).updateOne({ _id: doc._id }, { $set: { deletedAt: new Date(), ...(d.softDelete ?? {}) } });
    return { id, deleted: true };
  }

  async restore(key: string, id: string) {
    const d = this.def(key);
    const _id = this.oid(id);
    const unset = Object.fromEntries(Object.keys(d.softDelete ?? {}).map((k) => [k, true]));
    const r = await this.db.collection(d.coll).updateOne({ _id }, { $set: { deletedAt: null, ...unset } });
    if (!r.matchedCount) throw new NotFoundException('Запись не найдена');
    return this.get(key, id);
  }

  /** Объединить дубль: всё связанное с `id` переходит к `intoId`, дубль — в корзину. */
  async merge(key: string, id: string, intoId: string) {
    const d = this.def(key);
    const into = String(intoId || '').replace(`${key}:`, '');
    if (!into || into === id) throw new BadRequestException('Выберите, с чем объединить');
    const [from, to] = await Promise.all([this.one(d, id), this.one(d, into)]);
    const moved = await d.reassign(this.db, from, to);
    await this.db.collection(d.coll).updateOne({ _id: from._id }, { $set: { deletedAt: new Date(), mergedInto: to._id, ...(d.softDelete ?? {}) } });
    return { ...(await this.get(key, into)), moved };
  }

  /** Значения из Google-таблицы и из самих данных, которых ещё нет в справочнике (СП.6): с подсказкой «похоже на». */
  async candidates(key: string) {
    const d = this.def(key);
    if (!d.candidates) return { items: [], total: 0 };
    const [list, docs] = await Promise.all([d.candidates(this.db), this.docs(d)]);
    const items = list.map((c) => {
      let best: { name: string; score: number } | null = null;
      for (const x of docs) { const sc = similarity(c.name, d.name(x)); if (sc >= 0.6 && (!best || sc > best.score)) best = { name: d.name(x), score: Math.round(sc * 100) / 100 }; }
      return { ...c, similar: best };
    });
    return { items, total: items.length };
  }

  /** Перенести выбранные значения в справочник (только то, что выбрал человек). */
  async importNames(key: string, names: unknown) {
    const d = this.def(key);
    if (!d.fromName) throw new BadRequestException('Этот справочник заполняется вручную');
    const list = [...new Map((Array.isArray(names) ? names : []).map((n) => String(n ?? '').replace(/\s+/g, ' ').trim()).filter(Boolean).map((n) => [norm(n), n])).values()];
    if (!list.length) throw new BadRequestException('Отметьте, что добавить');
    const have = new Set((await this.docs(d)).map((x) => norm(d.name(x))));
    let added = 0;
    for (const n of list) {
      const doc = await d.fromName(n, this.db);
      if (have.has(norm(d.name(doc as Doc)))) continue;
      await this.db.collection(d.coll).insertOne(doc);
      have.add(norm(d.name(doc as Doc))); added++;
    }
    return { added };
  }

  /** Значения для выпадающих списков (используется в `/supply/lookups`). */
  async options(key: string): Promise<string[]> {
    const d = this.def(key);
    return d.options ? d.options(await this.docs(d)).filter(Boolean) : [];
  }
}
