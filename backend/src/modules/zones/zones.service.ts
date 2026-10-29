import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import { oid } from '../../common/list-query';
import { NotificationsService } from '../notifications/notifications.service';
import { DEFAULT_ZONES, MANAGEMENT, isWorking, personLabel, routeNotice, unassignedText, type Route } from './zone-routing';
import type { CreateZoneDto, UpdateZoneDto } from './dto/zones.dto';
import { Handoff, Zone, ZoneAssignment, type HandoffDocument, type ZoneAssignmentDocument, type ZoneDocument } from './zone.schema';

type Doc = Record<string, unknown>;
type PersonRow = Doc & { _id: Types.ObjectId };
const STATUS_RU: Record<string, string> = { active: 'Работает', vacation: 'В отпуске', fired: 'Уволен' };
const DAY = 24 * 3600 * 1000;

export interface ZoneNotice { type: string; text: string; sub?: string; href?: string }
export interface ZoneScope { personId: string | null; zoneCodes: string[]; management: boolean }

/**
 * Зоны ответственности: справочник зон, кто за что отвечает, адресация уведомлений (личный → зона → «Руководство»).
 * `persons` и `users` — общие с CRM коллекции: пишем только `persons.userId` / `persons.zoneCodes`.
 */
@Injectable()
export class ZonesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(ZonesService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectModel(Zone.name) private readonly zones: Model<ZoneDocument>,
    @InjectModel(ZoneAssignment.name) private readonly assignments: Model<ZoneAssignmentDocument>,
    @InjectModel(Handoff.name) private readonly handoffs: Model<HandoffDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly notices: NotificationsService,
  ) {}

  private db() { return this.connection.db!; }

  async onApplicationBootstrap() {
    try { await this.seed(); } catch (e) { this.log.warn(`Сид зон не выполнен: ${(e as Error).message}`); }
    if (process.env.NODE_ENV !== 'test') this.timer = setInterval(() => void this.tick(), 60 * 60_000);
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Раз в час: уволенных снять с зон, руководству напомнить «Не назначено» (не чаще раза в сутки). */
  private async tick() {
    try { await this.releaseFired(); await this.remindUnassigned(); } catch (e) { this.log.warn(`Проверка зон не выполнена: ${(e as Error).message}`); }
  }

  /** Недостающие базовые зоны по коду (повтор безопасен; переименованные и скрытые не трогаем). */
  async seed() {
    for (const z of DEFAULT_ZONES) {
      await this.zones.updateOne({ code: z.code, deletedAt: null }, { $setOnInsert: { ...z, active: true, system: true } }, { upsert: true }).exec();
    }
  }

  // ───────── зоны ─────────
  private async liveZones(onlyActive = false) {
    const f: Doc = { deletedAt: null };
    if (onlyActive) f.active = true;
    return (await this.zones.find(f).sort({ order: 1, _id: 1 }).lean().exec()) as unknown as Doc[];
  }

  private async workingPeople(codes?: string[]) {
    const f: Doc = { deletedAt: null, zoneCodes: codes ? { $in: codes } : { $exists: true, $ne: [] } };
    const rows = await this.db().collection('persons').find(f, { projection: { lastName: 1, firstName: 1, patronymic: 1, status: 1, userId: 1, zoneCodes: 1 } }).toArray();
    return rows.filter((p) => isWorking(p as { status?: string }));
  }

  async listZones() {
    const [zones, people] = await Promise.all([this.liveZones(), this.workingPeople()]);
    const items = zones.map((z) => {
      const ppl = people.filter((p) => ((p.zoneCodes as string[] | undefined) ?? []).includes(String(z.code)))
        .map((p) => ({ id: String(p._id), name: personLabel(p), hasLogin: !!p.userId }));
      return this.zoneView(z, ppl);
    });
    return { items, total: items.length, unassigned: items.filter((z) => z.active && z.empty).map((z) => ({ code: z.code, name: z.name })) };
  }

  private zoneView(z: Doc, people: Array<{ id: string; name: string; hasLogin: boolean }>) {
    return { id: String(z._id), code: String(z.code), name: String(z.name), hint: (z.hint as string | undefined) ?? '', order: (z.order as number | undefined) ?? 100, active: z.active !== false, system: !!z.system, people, empty: people.length === 0 };
  }

  async createZone(dto: CreateZoneDto) {
    if (await this.zones.exists({ code: dto.code, deletedAt: null })) throw new ConflictException('Зона с таким кодом уже есть');
    const last = await this.zones.findOne({ deletedAt: null }).sort({ order: -1 }).lean().exec();
    const doc = await this.zones.create({ code: dto.code, name: dto.name.trim(), hint: dto.hint?.trim(), order: (Number(last?.order) || 0) + 10, active: true, system: false });
    return this.zoneView(doc.toObject() as unknown as Doc, []);
  }

  async updateZone(id: string, dto: UpdateZoneDto) {
    const set: Doc = {};
    if (dto.name !== undefined) { if (!dto.name.trim()) throw new BadRequestException('Название зоны не может быть пустым'); set.name = dto.name.trim(); }
    if (dto.hint !== undefined) set.hint = dto.hint.trim();
    if (dto.order !== undefined) set.order = dto.order;
    if (dto.active !== undefined) set.active = dto.active;
    const z = await this.zones.findOneAndUpdate({ _id: oid(id, 'зоны'), deletedAt: null }, { $set: set }, { new: true }).lean().exec();
    if (!z) throw new NotFoundException('Зона не найдена');
    const people = (await this.workingPeople([String(z.code)])).map((p) => ({ id: String(p._id), name: personLabel(p), hasLogin: !!p.userId }));
    return this.zoneView(z as unknown as Doc, people);
  }

  async removeZone(id: string) {
    const z = await this.zones.findOne({ _id: oid(id, 'зоны'), deletedAt: null }).lean().exec();
    if (!z) throw new NotFoundException('Зона не найдена');
    if (z.system) throw new BadRequestException('Базовую зону удалить нельзя — её можно переименовать или скрыть');
    if ((await this.workingPeople([z.code])).length) throw new BadRequestException('В зоне есть сотрудники — сначала снимите их с зоны');
    await this.zones.updateOne({ _id: z._id }, { $set: { deletedAt: new Date() } }).exec();
    return { ok: true };
  }

  // ───────── сотрудники ─────────
  private async userMap(ids: unknown[]) {
    const list = ids.filter(Boolean) as Types.ObjectId[];
    if (!list.length) return new Map<string, Doc>();
    const rows = await this.db().collection('users').find({ _id: { $in: list } }, { projection: { username: 1, displayName: 1, role: 1, isActive: 1 } }).toArray();
    return new Map(rows.map((u) => [String(u._id), u as Doc]));
  }

  private staffRow(p: Doc, users: Map<string, Doc>, names: Map<string, string>) {
    const u = p.userId ? users.get(String(p.userId)) : undefined;
    const codes = (p.zoneCodes as string[] | undefined) ?? [];
    const status = (p.status as string | undefined) || 'active';
    return {
      id: String(p._id), name: personLabel(p), position: (p.position as string | undefined) ?? '',
      status, statusLabel: STATUS_RU[status] ?? status, phone: (p.phone as string | undefined) ?? '',
      hasLogin: !!p.userId,
      login: u ? { userId: String(u._id), username: String(u.username), displayName: String(u.displayName ?? u.username), role: String(u.role ?? ''), active: u.isActive !== false } : null,
      zoneCodes: codes, zones: codes.map((c) => ({ code: c, name: names.get(c) ?? c })),
    };
  }

  private async zoneNames() { return new Map((await this.liveZones()).map((z) => [String(z.code), String(z.name)])); }

  /** Список сотрудников (без удалённых): фильтр `zone` (код), плашка «Не назначено». */
  async staff(q: { zone?: string }, user?: { role?: string; isOwner?: boolean }) {
    const f: Doc = { deletedAt: null };
    if (q.zone) f.zoneCodes = String(q.zone);
    const [rows, names, zl] = await Promise.all([
      this.db().collection('persons').find(f, { projection: { salaryRate: 0, salaryKind: 0 } }).sort({ lastName: 1, firstName: 1 }).limit(1000).toArray(),
      this.zoneNames(), this.listZones(),
    ]);
    const users = await this.userMap(rows.map((p) => p.userId));
    const full = user?.isOwner || user?.role === 'admin' || user?.role === 'director';
    const items = rows.map((p) => {
      const r = this.staffRow(p as Doc, users, names);
      // ниже директора — только id, имя, должность, зоны (без телефона и логина)
      return full ? r : { id: r.id, name: r.name, position: r.position, zoneCodes: r.zoneCodes, zones: r.zones };
    });
    if (!full) return { items, total: items.length, unassigned: zl.unassigned };
    return { items, total: items.length, unassigned: zl.unassigned, loginsWithoutPerson: await this.loginsWithoutPerson(rows as Doc[]) };
  }

  /** Входы, не связанные ни с одним сотрудником, + подсказка «это …?» по фамилии и имени (СВ-1). */
  private async loginsWithoutPerson(persons: Doc[]) {
    const norm = (v: unknown) => String(v ?? '').toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
    const free = persons.filter((p) => !p.userId);
    return (await this.loginOptions()).items.filter((u) => !u.personId).map((u) => {
      const words = new Set(norm(u.displayName));
      const hit = free.filter((p) => { const ln = norm(p.lastName)[0]; const fn = norm(p.firstName)[0]; return !!ln && !!fn && words.has(ln) && words.has(fn); });
      return { userId: u.userId, username: u.username, displayName: u.displayName, role: u.role, suggestPersonId: hit.length === 1 ? String(hit[0]._id) : null };
    });
  }

  /** Создать сотрудника из входа без сотрудника: ФИО — из имени входа (СВ-2). */
  async createFromLogin(userId: string) {
    const uid = oid(userId, 'пользователя');
    const user = await this.db().collection('users').findOne({ _id: uid, accountType: { $ne: 'device' } }, { projection: { username: 1, displayName: 1 } });
    if (!user) throw new BadRequestException('Пользователь не найден — выберите из списка');
    const col = this.db().collection('persons');
    const other = await col.findOne({ userId: uid, deletedAt: null }, { projection: { lastName: 1, firstName: 1, patronymic: 1 } });
    if (other) throw new ConflictException(`Вход уже связан с ${personLabel(other)}`);
    const [lastName, firstName, ...rest] = String(user.displayName || user.username).trim().split(/\s+/);
    const now = new Date();
    const doc: Doc = { lastName: firstName ? lastName : '', firstName: firstName || lastName, status: 'active', userId: uid, deletedAt: null, createdAt: now, updatedAt: now };
    if (rest.length) doc.patronymic = rest.join(' ');
    const { insertedId } = await col.insertOne(doc);
    return this.row({ ...doc, _id: insertedId });
  }

  private async personDoc(id: string): Promise<PersonRow> {
    const p = await this.db().collection('persons').findOne({ _id: oid(id, 'сотрудника'), deletedAt: null });
    if (!p) throw new NotFoundException('Сотрудник не найден');
    return p as PersonRow;
  }

  private async row(p: Doc) {
    return this.staffRow(p, await this.userMap([p.userId]), await this.zoneNames());
  }

  /** Карточка: данные + история назначений в зоны + переданные объекты. */
  async person(id: string) {
    const p = await this.personDoc(id);
    const [row, assigns, hands] = await Promise.all([
      this.row(p),
      this.assignments.find({ personId: p._id as Types.ObjectId }).sort({ from: -1, _id: -1 }).limit(200).lean().exec(),
      this.handoffs.find({ $or: [{ fromPersonId: p._id as Types.ObjectId }, { toPersonId: p._id as Types.ObjectId }] }).sort({ at: -1 }).limit(100).lean().exec(),
    ]);
    const names = await this.zoneNames();
    return {
      ...row,
      history: {
        zones: assigns.map((a) => ({ id: String(a._id), zoneCode: a.zoneCode, zoneName: names.get(a.zoneCode) ?? a.zoneCode, from: a.from, to: a.to ?? null, note: a.note ?? null })),
        handoffs: await this.handoffViews(hands as unknown as Doc[]),
      },
    };
  }

  /** Назначить зоны сотруднику (полный список): добавленные открываются, снятые получают дату «по». */
  async setZones(id: string, codes: string[], actorId?: string, note?: string) {
    const p = await this.personDoc(id);
    const live = new Set((await this.liveZones()).map((z) => String(z.code)));
    const want = [...new Set(codes.map((c) => String(c).trim()).filter(Boolean))];
    const bad = want.filter((c) => !live.has(c));
    if (bad.length) throw new BadRequestException(`Зона не найдена: ${bad.join(', ')}`);
    const have = (p.zoneCodes as string[] | undefined) ?? [];
    const now = new Date();
    const by = actorId && Types.ObjectId.isValid(actorId) ? new Types.ObjectId(actorId) : undefined;
    for (const c of want.filter((c) => !have.includes(c))) {
      await this.assignments.create({ zoneCode: c, personId: p._id as Types.ObjectId, from: now, to: null, byUserId: by, note: note?.trim() || undefined });
    }
    for (const c of have.filter((c) => !want.includes(c))) {
      await this.assignments.updateMany({ personId: p._id as Types.ObjectId, zoneCode: c, to: null }, { $set: { to: now } }).exec();
    }
    const upd = await this.db().collection('persons').findOneAndUpdate({ _id: p._id }, { $set: { zoneCodes: want, updatedAt: now } }, { returnDocument: 'after' });
    return this.row((upd as Doc | null) ?? { ...p, zoneCodes: want });
  }

  /** Связать сотрудника со входом (или снять связь). Один вход — один сотрудник. */
  async linkUser(id: string, userId: string | null) {
    const p = await this.personDoc(id);
    const col = this.db().collection('persons');
    if (userId === null) {
      await col.updateOne({ _id: p._id }, { $unset: { userId: '' }, $set: { updatedAt: new Date() } });
      return this.row({ ...p, userId: undefined });
    }
    const uid = oid(userId, 'пользователя');
    const user = await this.db().collection('users').findOne({ _id: uid, accountType: { $ne: 'device' } }, { projection: { username: 1 } });
    if (!user) throw new BadRequestException('Пользователь не найден — выберите из списка');
    const other = await col.findOne({ userId: uid, deletedAt: null, _id: { $ne: p._id } }, { projection: { lastName: 1, firstName: 1, patronymic: 1 } });
    if (other) throw new ConflictException(`Вход уже связан с ${personLabel(other)}`);
    try {
      await col.updateOne({ _id: p._id }, { $set: { userId: uid, updatedAt: new Date() } });
    } catch (e) {
      if ((e as { code?: number }).code === 11000) throw new ConflictException('Вход уже связан с другим сотрудником');
      throw e;
    }
    return this.row({ ...p, userId: uid });
  }

  /** Входы для выбора в карточке: кто уже занят и кем. */
  async loginOptions() {
    const [users, linked] = await Promise.all([
      this.db().collection('users').find({ accountType: { $ne: 'device' }, isActive: { $ne: false } }, { projection: { username: 1, displayName: 1, role: 1 } }).sort({ username: 1 }).limit(500).toArray(),
      this.db().collection('persons').find({ userId: { $type: 'objectId' }, deletedAt: null }, { projection: { lastName: 1, firstName: 1, patronymic: 1, userId: 1 } }).toArray(),
    ]);
    const by = new Map(linked.map((p) => [String(p.userId), p]));
    const items = users.map((u) => {
      const p = by.get(String(u._id));
      return { userId: String(u._id), username: String(u.username), displayName: String(u.displayName ?? u.username), role: String(u.role ?? ''), personId: p ? String(p._id) : null, personName: p ? personLabel(p) : null };
    });
    return { items, total: items.length };
  }

  // ───────── уволенные, напоминания ─────────
  /** Уволенных снять с зон (в историю — дата «по»). */
  async releaseFired() {
    const rows = await this.db().collection('persons').find({ deletedAt: null, status: 'fired', zoneCodes: { $exists: true, $ne: [] } }, { projection: { _id: 1 } }).toArray();
    for (const p of rows) await this.setZones(String(p._id), [], undefined, 'Сотрудник уволен');
    return rows.length;
  }

  /** Руководству — «Не назначено: …», не чаще раза в сутки на человека. Возвращает, скольким ушло. */
  async remindUnassigned(now = new Date()) {
    const { unassigned } = await this.listZones();
    if (!unassigned.length) return 0;
    const users = await this.zoneUserIds([MANAGEMENT]);
    const since = new Date(Math.floor(now.getTime() / DAY) * DAY);
    let sent = 0;
    for (const uid of users) {
      const done = await this.db().collection('notifications').findOne({ userId: new Types.ObjectId(uid), type: 'zone_unassigned', createdAt: { $gte: since } }, { projection: { _id: 1 } });
      if (done) continue;
      if (await this.notices.safe({ userId: uid, type: 'zone_unassigned', text: unassignedText(unassigned.map((z) => z.name)), href: '#staff?tab=zones', zoneCode: MANAGEMENT })) sent++;
    }
    return sent;
  }

  // ───────── адресация ─────────
  private async zoneUserIds(codes: string[]): Promise<string[]> {
    const people = (await this.workingPeople(codes)).filter((p) => p.userId);
    const ids = people.map((p) => p.userId as Types.ObjectId);
    if (!ids.length) return [];
    const active = await this.db().collection('users').find({ _id: { $in: ids }, isActive: { $ne: false } }, { projection: { _id: 1 } }).toArray();
    return active.map((u) => String(u._id));
  }

  /** Кому адресовать событие зоны (§4.6). `personId` — личный ответственный объекта. */
  async route(zoneCode: string, personId?: unknown): Promise<Route> {
    let personal: { userId?: string | null } | null = null;
    if (personId && Types.ObjectId.isValid(String(personId))) {
      const p = await this.db().collection('persons').findOne({ _id: new Types.ObjectId(String(personId)), deletedAt: null }, { projection: { userId: 1, status: 1 } });
      if (p && isWorking(p as { status?: string })) personal = { userId: p.userId ? String(p.userId) : null };
    }
    const zoneUsers = personal?.userId ? [] : await this.zoneUserIds([zoneCode]);
    const managementUsers = personal?.userId || zoneUsers.length ? [] : await this.zoneUserIds([MANAGEMENT]);
    return routeNotice(zoneCode, { personal, zoneUsers, managementUsers });
  }

  /**
   * Отправить уведомление по зоне. Исполнителя действия не уведомляем. Никого нет — руководству с пометкой «Не назначено: <зона>».
   * Ошибки не пробрасываются. Возвращает маршрут и число отправленных.
   */
  async notifyZone(zoneCode: string, n: ZoneNotice, opts: { personId?: unknown; actorId?: string } = {}): Promise<Route & { sent: number }> {
    const r = await this.route(zoneCode, opts.personId).catch((e) => { this.log.warn(`Маршрут зоны ${zoneCode}: ${(e as Error).message}`); return null; });
    if (!r) return { userIds: [], zoneCode, unassigned: false, via: 'zone', sent: 0 };
    let sub = n.sub;
    if (r.unassigned) {
      const name = (await this.zoneNames()).get(zoneCode) ?? zoneCode;
      sub = [unassignedText([name]), n.sub].filter(Boolean).join(' · ');
    }
    let sent = 0;
    for (const uid of r.userIds) if (await this.notices.safe({ ...n, sub, userId: uid, zoneCode }, opts.actorId)) sent++;
    return { ...r, sent };
  }

  /** Зоны пользователя для «Сегодня»: связь вход → сотрудник → зоны. */
  async scopeOf(userId?: string): Promise<ZoneScope | null> {
    if (!userId || !Types.ObjectId.isValid(userId)) return null;
    const p = await this.db().collection('persons').findOne({ userId: new Types.ObjectId(userId), deletedAt: null }, { projection: { zoneCodes: 1 } });
    if (!p) return null;
    const codes = (p.zoneCodes as string[] | undefined) ?? [];
    return { personId: String(p._id), zoneCodes: codes, management: codes.includes(MANAGEMENT) };
  }

  // ───────── передачи ─────────
  /** Записать передачу, если ответственный сменился. Ошибка записи не ломает основную операцию. */
  async recordHandoff(h: { entity: string; entityId: unknown; field: 'responsibleId' | 'assigneeId'; from?: unknown; to?: unknown; byUserId?: string; reason?: string }) {
    const same = String(h.from ?? '') === String(h.to ?? '');
    if (same) return null;
    try {
      const o = (v: unknown) => (v && Types.ObjectId.isValid(String(v)) ? new Types.ObjectId(String(v)) : undefined);
      return await this.handoffs.create({
        entity: h.entity, entityId: o(h.entityId), field: h.field, fromPersonId: o(h.from), toPersonId: o(h.to),
        at: new Date(), byUserId: o(h.byUserId), reason: h.reason?.trim() || undefined,
      });
    } catch (e) {
      this.log.warn(`Передача не записана: ${(e as Error).message}`);
      return null;
    }
  }

  /** История передач объекта: «Передано: Иванов → Петров, дата, кто». */
  async handoffHistory(entity: string, entityId: string) {
    const rows = await this.handoffs.find({ entity, entityId: oid(entityId, 'объекта') }).sort({ at: -1 }).limit(100).lean().exec();
    return { items: await this.handoffViews(rows as unknown as Doc[]) };
  }

  private async handoffViews(rows: Doc[]) {
    const pids = rows.flatMap((r) => [r.fromPersonId, r.toPersonId]).filter(Boolean) as Types.ObjectId[];
    const uids = rows.map((r) => r.byUserId).filter(Boolean) as Types.ObjectId[];
    const [ppl, usr] = await Promise.all([
      pids.length ? this.db().collection('persons').find({ _id: { $in: pids } }, { projection: { lastName: 1, firstName: 1, patronymic: 1 } }).toArray() : [],
      this.userMap(uids),
    ]);
    const pn = new Map(ppl.map((p) => [String(p._id), personLabel(p)]));
    return rows.map((r) => ({
      id: String(r._id), entity: String(r.entity), entityId: String(r.entityId), field: String(r.field),
      fromPersonId: r.fromPersonId ? String(r.fromPersonId) : null, from: r.fromPersonId ? pn.get(String(r.fromPersonId)) ?? null : null,
      toPersonId: r.toPersonId ? String(r.toPersonId) : null, to: r.toPersonId ? pn.get(String(r.toPersonId)) ?? null : null,
      at: r.at, by: r.byUserId ? String(usr.get(String(r.byUserId))?.displayName ?? usr.get(String(r.byUserId))?.username ?? '') || null : null,
      reason: (r.reason as string | undefined) ?? null,
    }));
  }
}
