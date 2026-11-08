import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import type { Connection } from 'mongoose';
import path from 'path';
import { latency } from '../../../common/interceptors/latency-histogram';
import type { SwitchReportDto } from './switch.dto';
import {
  AUTO_REFRESH_MIN, CACHE_MS, COL_STATE, STATE_ID, autoRefreshDue, canRefreshNow, copyAgeMin, readinessBlockers, defaultRole, jobBusy, parseSelf, peerOf, secretMatches, staleReason, versionLabel, versionsConflict,
  type SwitchDoc, type SwitchJob, type SwitchMode, type SwitchRole, type SwitchSelf,
} from './switch.rules';

/** Мост «живой», если трогал файл `alive` не позже, чем 3 минуты назад (cron раз в минуту). */
const BRIDGE_ALIVE_MS = 3 * 60_000;
/** Как часто заново мерить второй сервер, пока идёт опрос экрана. На переключение не влияет. */
const SPEED_CACHE_MS = 15_000;

type SideSpeed = { p50: number | null; p95: number | null; requests: number | null; slow: number | null; probeMs: number | null };
type PeerSpeed = { p50: number | null; p95: number | null; requests: number; slow: number };

/**
 * Состояние «главный/запасной» и режим «только чтение». Один документ `switch` в `app_control_state`, запись драйвером.
 * Без HA_SELF сервис ничего не делает: нет таймера, нет обращений к базе, маршруты отвечают 404.
 * Кэш режима обновляет таймер раз в 2 с; запрос на запись читает только память.
 */
@Injectable()
export class SwitchService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SwitchService.name);
  private cache: { mode: SwitchMode; role: SwitchRole } = { mode: 'normal', role: 'main' };
  private timer?: NodeJS.Timeout;
  private autoTimer?: NodeJS.Timeout;
  private autoKick?: NodeJS.Timeout;
  /** Когда сами ставили автообновление копии (C042-A3); 0 — не ставили. */
  private autoAt = 0;
  private verCache: { at: number; label: string | null } | null = null;
  private speedAt = 0;
  private speedPeer: { ms: number; speed: PeerSpeed | null } | null = null;

  constructor(@InjectConnection() private readonly connection: Connection) {}

  /** Читается при каждом вызове: переменная окружения не меняется на ходу, но тест выставляет её до старта. */
  get self(): SwitchSelf | null { return parseSelf(process.env.HA_SELF); }
  get enabled(): boolean { return this.self !== null; }
  private get dir(): string { return process.env.HA_SWITCH_DIR || '/host-switch'; }
  private col() { return this.connection.db!.collection<SwitchDoc & { _id: string }>(COL_STATE); }
  // _id — строка, а не ObjectId: типы драйвера этого не любят
  private filter(extra: Record<string, unknown> = {}) { return { _id: STATE_ID, ...extra } as never; }

  async onModuleInit() {
    if (!this.enabled) return;
    try { await this.refresh(); } catch (e) { this.log.warn(`режим переключения: ${(e as Error).message}`); }
    this.timer = setInterval(() => void this.refresh().catch(() => undefined), CACHE_MS);
    this.timer.unref();
    // C042-A3: главный сам обновляет копию у запасного, пока ПК дома выключен
    this.autoTimer = setInterval(() => void this.autoRefresh().catch(() => undefined), 60_000);
    this.autoTimer.unref();
    this.autoKick = setTimeout(() => void this.autoRefresh().catch(() => undefined), 30_000);
    this.autoKick.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); if (this.autoTimer) clearInterval(this.autoTimer); if (this.autoKick) clearTimeout(this.autoKick); }

  assertEnabled(): SwitchSelf {
    const s = this.self;
    if (!s) throw new NotFoundException('Not Found');
    return s;
  }

  /** Для middleware: только память, O(1). */
  isReadOnly(): boolean { return this.enabled && this.cache.mode === 'readonly'; }

  /** Документ; нет — создаётся с ролью по умолчанию (дом — главный, офис — запасной). */
  private async load(self: SwitchSelf): Promise<SwitchDoc> {
    const col = this.col();
    await col.updateOne(this.filter(), { $setOnInsert: { mode: 'normal', role: defaultRole(self), job: null } } as never, { upsert: true }).catch((e: { code?: number }) => {
      if (e.code !== 11000) throw e; // гонка двух upsert — документ уже есть
    });
    return (await col.findOne(this.filter()))! as SwitchDoc;
  }

  private remember(d: Pick<SwitchDoc, 'mode' | 'role'>) { this.cache = { mode: d.mode, role: d.role }; }

  /** Раз в 2 с (и по требованию): подтянуть документ, снять брошенную работу. */
  async refresh(): Promise<SwitchDoc | null> {
    const self = this.self;
    if (!self) return null;
    let doc = await this.load(self);
    const reason = jobBusy(doc.job) ? staleReason(doc.job, Date.now(), await this.bridgeAlive()) : null;
    if (reason && doc.job) {
      const set: Record<string, unknown> = { 'job.state': 'failed', 'job.error': reason, 'job.finishedAt': new Date().toISOString() };
      if (doc.role === 'main') set.mode = 'normal'; // главный не должен остаться в «только чтение» навсегда
      await this.col().updateOne(this.filter({ 'job.id': doc.job.id, 'job.state': { $in: ['queued', 'running'] } }), { $set: set } as never);
      doc = (await this.col().findOne(this.filter()))! as SwitchDoc;
      this.log.warn(`переключение ${doc.job?.id}: ${reason}`);
    }
    this.remember(doc);
    return doc;
  }

  private async bridgeAlive(): Promise<boolean> {
    try { return Date.now() - (await fs.stat(path.join(this.dir, 'alive'))).mtimeMs < BRIDGE_ALIVE_MS; } catch { return false; }
  }

  /** Время последнего обновления копии на этом сервере (файл пишет SRV-ERP/refresh-copy.sh); нет — null. */
  private async lastRefresh(): Promise<string | null> {
    try {
      const s = (await fs.readFile(path.join(this.dir, 'last-refresh'), 'utf8')).trim();
      return Number.isNaN(Date.parse(s)) ? null : s;
    } catch { return null; }
  }

  /**
   * Версия сборки этого сервера (C042-A5) — из `backend/pwa/version.json`, который пишет release.sh
   * (папка смонтирована в /app/pwa, поэтому версия видна без перезапуска). Нет файла — APP_VERSION из env.
   */
  async appVersion(): Promise<string | null> {
    const file = process.env.PWA_VERSION_FILE || '/app/pwa/version.json';
    try {
      const st = await fs.stat(file);
      if (!this.verCache || this.verCache.at !== st.mtimeMs) this.verCache = { at: st.mtimeMs, label: versionLabel(JSON.parse(await fs.readFile(file, 'utf8'))) };
      return this.verCache.label ?? (process.env.APP_VERSION?.trim() || null);
    } catch { return process.env.APP_VERSION?.trim() || null; }
  }

  /** Минуты между автообновлениями копии (C042-A3): HA_AUTO_REFRESH_MIN, по умолчанию 15, 0 — выключено. */
  private autoMinutes(): number {
    const v = Number(process.env.HA_AUTO_REFRESH_MIN);
    return process.env.HA_AUTO_REFRESH_MIN !== undefined && Number.isFinite(v) && v >= 0 ? v : AUTO_REFRESH_MIN;
  }

  /**
   * C042-A3: главный сам ставит обновление копии, если она старше N минут, сервер в обычном режиме,
   * работы нет и мост жив. Ошибка не валит сервер — только запись в журнал (следующая попытка через N минут).
   */
  async autoRefresh(): Promise<{ queued: boolean; reason: string }> {
    if (!this.enabled) return { queued: false, reason: 'переключение не включено' };
    const doc = await this.refresh();
    if (!doc) return { queued: false, reason: 'нет состояния' };
    const due = autoRefreshDue({
      role: doc.role, mode: doc.mode, busy: jobBusy(doc.job), bridgeAlive: await this.bridgeAlive(),
      peerHealthy: doc.peerHealthy ?? null, copyAgeMin: copyAgeMin(doc.peerCopyAt, Date.now()),
      lastAutoAt: this.autoAt, now: Date.now(), minutes: this.autoMinutes(),
    });
    if (!due.due) return { queued: false, reason: due.reason };
    try {
      await this.refreshPeer();
      this.autoAt = Date.now();
      this.log.log(`автообновление копии: заявка поставлена (${due.reason})`);
      return { queued: true, reason: due.reason };
    } catch (e) {
      this.autoAt = Date.now(); // не долбим каждую минуту, если не вышло
      const msg = e instanceof Error ? e.message : String(e);
      this.log.warn(`автообновление копии не поставлено: ${msg}`);
      return { queued: false, reason: msg };
    }
  }

  /** Публичная короткая справка для соседа: без данных, только роль, версия и возраст копии. */
  async ping() {
    const self = this.self;
    let role: SwitchRole | null = null;
    if (self) { try { role = (await this.refresh())?.role ?? null; } catch { role = null; } }
    const snap = latency.snapshot();
    return {
      self, role, version: await this.appVersion(), copyAt: await this.lastRefresh(),
      speed: { p50: snap.p50, p95: snap.p95, requests: snap.requests, slow: snap.slow },
    };
  }

  private localSpeed(): PeerSpeed {
    const s = latency.snapshot();
    return { p50: s.p50, p95: s.p95, requests: s.requests, slow: s.slow };
  }

  private readSpeed(raw: unknown): PeerSpeed | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    const requests = n(o.requests);
    return { p50: n(o.p50), p95: n(o.p95), requests: requests ?? 0, slow: n(o.slow) ?? 0 };
  }

  /** Скорость обоих: свой счётчик запросов и замер соседа. Пустые стороны — «нет данных» на экране. */
  private speedSides(selfName: 'home' | 'office' | null, peer: { ms?: number; speed?: PeerSpeed | null } | null) {
    const empty = (): SideSpeed => ({ p50: null, p95: null, requests: null, slow: null, probeMs: null });
    const home = empty();
    const office = empty();
    const mine = selfName === 'office' ? office : home;
    const other = selfName === 'office' ? home : office;
    const loc = this.localSpeed();
    mine.p50 = loc.p50; mine.p95 = loc.p95; mine.requests = loc.requests; mine.slow = loc.slow;
    if (peer?.speed) {
      other.p50 = peer.speed.p50; other.p95 = peer.speed.p95; other.requests = peer.speed.requests; other.slow = peer.speed.slow;
    }
    if (typeof peer?.ms === 'number') other.probeMs = peer.ms;
    return { home, office };
  }

  /** Повторный опрос экрана не долбит сосед каждые 3 с. Кэш только для цифр, не для решения «кто главный». */
  private async peerSpeedCached(): Promise<{ ms: number; speed: PeerSpeed | null } | null> {
    if (!process.env.HA_PEER_URL?.trim()) return null;
    if (this.speedPeer && Date.now() - this.speedAt < SPEED_CACHE_MS) return this.speedPeer;
    const peer = await this.probePeer();
    if (!peer) return null;
    this.speedPeer = { ms: peer.ms ?? 0, speed: peer.speed ?? null };
    this.speedAt = Date.now();
    return this.speedPeer;
  }

  /** Спросить соседа по HA_PEER_URL (4 с). Нет адреса — null; не ответил — healthy:false. */
  async probePeer(): Promise<{ healthy: boolean; ms?: number; speed?: PeerSpeed | null; self?: string | null; role?: string | null; version?: string | null; copyAt?: string | null } | null> {
    const base = process.env.HA_PEER_URL?.trim().replace(/\/+$/, '');
    if (!base) return null;
    const t0 = Date.now();
    try {
      const r = await fetch(`${base}/api/control/switch/ping`, { signal: AbortSignal.timeout(4000) });
      const ms = Date.now() - t0;
      if (!r.ok) return { healthy: false, ms };
      const b = (await r.json()) as Record<string, unknown>;
      const str = (v: unknown) => (typeof v === 'string' ? v : null);
      return {
        healthy: true, ms, speed: this.readSpeed(b.speed),
        self: str(b.self), role: str(b.role), version: str(b.version), copyAt: str(b.copyAt),
      };
    } catch { return { healthy: false, ms: Date.now() - t0 }; }
  }

  /** Переключение не включено: всё равно показываем оба сервера и что мешает включить. */
  private async overview() {
    const [peer, alive, ownCopy, version] = await Promise.all([this.probePeer(), this.bridgeAlive(), this.lastRefresh(), this.appVersion()]);
    // копия у того, кто запасной: у соседа, а если этот сервер сам обновляется из бэкапа — у себя
    const copyAt = ownCopy ?? peer?.copyAt ?? undefined;
    const age = copyAgeMin(copyAt ?? undefined, Date.now());
    const selfName = ownCopy ? 'office' : 'home';
    return {
      enabled: false,
      self: null,
      selfIsCopy: !!ownCopy,
      version,
      peer: {
        configured: !!peer,
        healthy: peer ? peer.healthy : null,
        version: peer?.version ?? null,
        role: peer?.role ?? null,
        copyAgeMin: age,
        checkedAt: peer ? new Date().toISOString() : null,
      },
      bridge: { alive },
      blockers: readinessBlockers({ self: null, peerUrlSet: !!peer, peerHealthy: peer ? peer.healthy : null, copyAgeMin: age, bridgeAlive: alive }),
      canStart: false,
      canRefresh: false,
      canEmergency: false,
      speed: this.speedSides(selfName, peer),
    };
  }

  async status() {
    const self = this.self;
    if (!self) return this.overview();
    const doc = (await this.refresh())!;
    const [alive, version, peerSpeed] = await Promise.all([this.bridgeAlive(), this.appVersion(), this.peerSpeedCached()]);
    const busy = jobBusy(doc.job);
    const age = copyAgeMin(doc.peerCopyAt, Date.now());
    const peerVersion = doc.peerVersion ?? null;
    const blockers = readinessBlockers({ self, peerUrlSet: true, peerHealthy: doc.peerHealthy ?? null, copyAgeMin: age, bridgeAlive: alive, selfVersion: version, peerVersion });
    return {
      blockers,
      enabled: true,
      self,
      version,
      autoRefresh: { enabled: this.autoMinutes() > 0, minutes: this.autoMinutes(), lastAt: this.autoAt ? new Date(this.autoAt).toISOString() : null },
      role: doc.role,
      mode: doc.mode,
      job: doc.job ?? null,
      peer: {
        name: peerOf(self),
        version: peerVersion,
        copyAgeMin: age,
        healthy: doc.peerHealthy ?? null,
        checkedAt: doc.peerCheckedAt ?? null,
      },
      bridge: { alive },
      canStart: doc.role === 'main' && doc.mode === 'normal' && !busy && alive && !versionsConflict(version, peerVersion),
      canRefresh: canRefreshNow(doc.role, doc.mode, busy, alive),
      canEmergency: doc.role === 'standby' && !busy && alive,
      speed: this.speedSides(self, peerSpeed),
    };
  }

  /** Захват работы одним запросом к базе: кто успел, тот и владеет; второй получает 409. */
  private async acquire(role: SwitchRole, direction: string): Promise<SwitchJob> {
    const self = this.assertEnabled();
    const doc = await this.refresh();
    if (!(await this.bridgeAlive())) {
      throw new ServiceUnavailableException('Мост переключения на сервере не запущен (cron раз в минуту). Переключение недоступно.');
    }
    const job: SwitchJob = { id: randomBytes(6).toString('hex'), direction, step: 'queued', state: 'queued', startedAt: new Date().toISOString() };
    const r = await this.col().updateOne(
      this.filter({ role, 'job.state': { $nin: ['queued', 'running'] } }),
      { $set: { job, updatedAt: new Date() } } as never,
    );
    if (r.matchedCount !== 1) {
      if (jobBusy(doc?.job)) throw new ConflictException('Переключение уже идёт. Дождитесь окончания.');
      throw new ConflictException(role === 'main'
        ? `Этот сервер (${self}) сейчас не главный. Запустите переключение на главном сервере.`
        : `Этот сервер (${self}) уже главный. Аварийный подъём не нужен.`);
    }
    return job;
  }

  /** Файл-запрос для хост-моста; temp + rename, чтобы мост не прочитал половину. */
  private async writeRequest(job: SwitchJob, kind: 'switch' | 'emergency' | 'refresh') {
    const file = path.join(this.dir, 'request');
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `id=${job.id}\nkind=${kind}\nrequestedAt=${job.startedAt}\n`, { mode: 0o644 });
    await fs.rename(tmp, file);
  }

  private async queue(role: SwitchRole, direction: string, kind: 'switch' | 'emergency' | 'refresh') {
    const job = await this.acquire(role, direction);
    try {
      await this.writeRequest(job, kind);
    } catch (e) {
      await this.col().updateOne(this.filter({ 'job.id': job.id }), { $set: { job: null } } as never);
      this.log.error(`запись заявки: ${(e as Error).message}`);
      throw new ServiceUnavailableException('Не удалось передать заявку мосту переключения. Папка заявок недоступна.');
    }
    return { ok: true, job };
  }

  async start() {
    const self = this.assertEnabled();
    return this.queue('main', `${self}->${peerOf(self)}`, 'switch');
  }

  async emergency() {
    this.assertEnabled();
    return this.queue('standby', 'emergency', 'emergency');
  }

  /** Обновить запасной: код и база, без смены домена. Только с главного, тем же захватом, что и переключение. */
  async refreshPeer() {
    this.assertEnabled();
    return this.queue('main', 'refresh', 'refresh');
  }

  /** Секрет моста из файла рядом с заявкой; нет файла — отчёты не принимаются. */
  private async secret(): Promise<string> {
    try { return (await fs.readFile(path.join(this.dir, 'secret'), 'utf8')).trim(); } catch { return ''; }
  }

  /** Отчёт моста. headersOk=false — запрос пришёл через прокси (не с хоста). */
  async report(dto: SwitchReportDto, given: string | undefined, viaProxy: boolean) {
    const self = this.assertEnabled();
    if (viaProxy || !secretMatches(given, await this.secret())) throw new ForbiddenException('Отчёт принимается только от моста на самом сервере');
    const now = new Date();
    const set: Record<string, unknown> = { updatedAt: now };
    if (dto.peer) {
      if (dto.peer.version !== undefined) set.peerVersion = dto.peer.version;
      if (dto.peer.copyAt !== undefined) set.peerCopyAt = dto.peer.copyAt;
      if (dto.peer.healthy !== undefined) set.peerHealthy = dto.peer.healthy;
      set.peerCheckedAt = now.toISOString();
    }
    const doc = await this.load(self);
    if (dto.id === 'self') {
      // вернувшийся старый главный: мост, увидев домен не у нас, просит стать запасным (работы при этом нет)
      if (jobBusy(doc.job)) throw new ConflictException('Идёт переключение');
      if (dto.role) set.role = dto.role;
      if (dto.mode) set.mode = dto.mode;
    } else if (dto.id !== 'peer') {
      const job = doc.job;
      if (!job || job.id !== dto.id) throw new ConflictException('Это отчёт о другой работе');
      const state = dto.state ?? 'running';
      if (!jobBusy(job) && state === 'running') throw new ConflictException('Работа уже завершена');
      if (dto.step) set['job.step'] = dto.step;
      set['job.state'] = state;
      if (state === 'failed') set['job.error'] = (dto.error ?? 'Переключение не удалось').slice(0, 2000);
      else if (dto.error) set['job.error'] = dto.error.slice(0, 2000); // предупреждение, не провал
      if (state !== 'running') set['job.finishedAt'] = now.toISOString();
      if (state === 'failed' && doc.role === 'main') set.mode = 'normal'; // неудача до переключения: сайт снова пишет
      if (dto.role) set.role = dto.role;
      if (dto.mode) set.mode = dto.mode;
    }
    const filter = dto.id === 'peer' || dto.id === 'self' ? this.filter() : this.filter({ 'job.id': dto.id });
    const r = await this.col().updateOne(filter, { $set: set } as never);
    if (r.matchedCount !== 1) throw new ConflictException('Работа изменилась во время отчёта');
    const fresh = (await this.col().findOne(this.filter()))! as SwitchDoc;
    this.remember(fresh);
    return { ok: true, role: fresh.role, mode: fresh.mode, job: fresh.job ?? null };
  }
}
