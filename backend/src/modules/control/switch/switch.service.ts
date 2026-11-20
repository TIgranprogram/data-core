import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import type { Connection } from 'mongoose';
import path from 'path';
import { latency } from '../../../common/interceptors/latency-histogram';
import type { SaveSwitchScheduleDto, SwitchReportDto } from './switch.dto';
import { bridgeFiles, publishBridgeRequest, RequestNotPublished } from './switch-outbox';
import { currentDomain, EMPTY_DOMAIN, idleReason, isFresh, recoveryWarning, refreshDomainReason, switchReadiness } from './switch-readiness';
import { claimSchedule, refreshAttempt, SCHEDULE_LANES, scheduleConfig, scheduleDecision, scheduleProgress, scheduleView, type RefreshScope, type ScheduleConfig } from './schedule.rules';
import {
  AUTO_REFRESH_MIN, CACHE_MS, COL_STATE, STATE_ID, canRefreshNow, copyAgeMin, readinessBlockers, defaultRole, jobBusy, parseSelf, peerOf, secretMatches, staleReason, versionLabel,
  type SwitchDoc, type SwitchJob, type SwitchMode, type SwitchRole, type SwitchSelf,
} from './switch.rules';

/** Мост «живой», если трогал файл `alive` не позже, чем 3 минуты назад (cron раз в минуту). */
const BRIDGE_ALIVE_MS = 3 * 60_000;
/** Как часто заново мерить второй сервер, пока идёт опрос экрана. На переключение не влияет. */
const SPEED_CACHE_MS = 15_000;
const DELIVERY_LEASE_MS = 30_000;

type SideSpeed = { p50: number | null; p95: number | null; requests: number | null; slow: number | null; probeMs: number | null };
type PeerSpeed = { p50: number | null; p95: number | null; requests: number; slow: number };
type PeerProbe = {
  healthy: boolean;
  ms?: number;
  speed?: PeerSpeed | null;
  self?: string | null;
  role?: string | null;
  version?: string | null;
  copyAt?: string | null;
};

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
  private verCache: { at: number; label: string | null } | null = null;
  private speedAt = 0;
  private cachedPeer: PeerProbe | null = null;

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
    const saved = await col.findOne(this.filter());
    if (saved) return saved;
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
    if (jobBusy(doc.job)) {
      const now = Date.now();
      const alive = await this.bridgeAlive();
      const reason = staleReason(doc.job, now, alive);
      const job = doc.job!;
      if (reason) {
        await this.failJob(doc, job, reason, now);
        doc = (await this.col().findOne(this.filter()))!;
      } else if (job.state === 'queued' && alive && doc.bridgeDelivery?.jobId === job.id && !doc.bridgeDelivery.delivered) {
        await this.reconcileDelivery(doc);
        doc = (await this.col().findOne(this.filter()))!;
      }
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

  private revisionFilter(doc: SwitchDoc) {
    return { 'scheduleConfig.revision': doc.scheduleConfig?.revision ?? null };
  }

  private domainFilter(doc: SwitchDoc) {
    return {
      'domain.owner': doc.domain?.owner ?? null,
      'domain.checkedAt': doc.domain?.checkedAt ?? null,
    };
  }

  async getSchedule() {
    const self = this.assertEnabled();
    const doc = await this.load(self);
    const reason = idleReason(doc);
    return scheduleView(doc, this.autoMinutes(), !reason, reason);
  }

  async saveSchedule(dto: SaveSwitchScheduleDto) {
    const self = this.assertEnabled();
    for (const lane of SCHEDULE_LANES) {
      if (dto[lane].enabled && dto[lane].days.length === 0) throw new BadRequestException('Для включённого расписания выберите хотя бы один день недели.');
    }
    const doc = await this.load(self);
    const conflict = () => new ConflictException({
      code: 'SCHEDULE_REVISION_CONFLICT', message: 'Расписание уже изменили. Откройте текущие настройки перед повторным сохранением.',
    });
    if ((doc.scheduleConfig?.revision ?? 0) !== dto.expectedRevision) throw conflict();
    const reason = idleReason(doc);
    if (reason) throw new ConflictException(reason);

    const config: ScheduleConfig = {
      revision: dto.expectedRevision + 1,
      timezone: dto.timezone,
      data: { ...dto.data, days: [...dto.data.days].sort((a, b) => a - b) },
      code: { ...dto.code, days: [...dto.code.days].sort((a, b) => a - b) },
      savedAt: new Date().toISOString(),
    };
    const result = await this.col().updateOne(
      this.filter({ ...this.revisionFilter(doc), role: 'main', mode: 'normal', 'job.state': { $nin: ['queued', 'running'] } }),
      { $set: { scheduleConfig: config } },
    );
    const fresh = await this.load(self);
    if (result.matchedCount !== 1) {
      if ((fresh.scheduleConfig?.revision ?? 0) !== dto.expectedRevision) throw conflict();
      throw new ConflictException(idleReason(fresh) ?? 'Состояние сервера изменилось. Повторите сохранение.');
    }
    const freshReason = idleReason(fresh);
    return scheduleView(fresh, this.autoMinutes(), !freshReason, freshReason);
  }

  /** Один актуальный слот на тик. Для старого графика сохраняем обновление только данных. */
  async autoRefresh(): Promise<{ queued: boolean; reason: string }> {
    const self = this.self;
    if (!self) return { queued: false, reason: 'Переключение не включено.' };
    const doc = (await this.refresh())!;
    const now = Date.now();
    const reason = idleReason(doc) ?? refreshDomainReason(doc, self, now, !!doc.scheduleConfig);
    if (reason) return { queued: false, reason };
    if (doc.peerHealthy !== true || (doc.scheduleConfig && !isFresh(doc.peerCheckedAt, now))) {
      return { queued: false, reason: 'Мост не подтвердил, что второй сервер отвечает.' };
    }
    const config = scheduleConfig(doc, this.autoMinutes());
    const due = SCHEDULE_LANES.map((lane) => ({
      lane,
      slot: scheduleDecision(config, lane, doc.scheduleRuntime?.[lane], now, doc.peerCopyAt).slot,
    })).find(({ slot }) => slot);
    if (!due?.slot) return { queued: false, reason: 'Время обновления ещё не наступило.' };

    try {
      const scope = due.lane === 'data' ? 'data' : 'both';
      const run = claimSchedule(doc, due.lane, due.slot, now);
      const previous = doc.scheduleRuntime?.[due.lane];
      const prefix = 'scheduleRuntime.' + due.lane;
      const job = await this.acquire(doc, 'main', 'refresh', {
        refreshScope: scope,
        scheduleKeys: { [due.lane]: due.slot.key },
        scheduleExpiresAt: config.revision ? run.expiresAt : undefined,
      }, {
        ...this.revisionFilter(doc),
        ...this.domainFilter(doc),
        peerHealthy: true,
        peerCheckedAt: doc.peerCheckedAt ?? null,
        [prefix + '.slot']: previous?.slot ?? null,
        [prefix + '.attempts']: previous?.attempts ?? null,
      }, { [prefix]: run });
      await this.deliverQueued({ ...doc, scheduleRuntime: { ...doc.scheduleRuntime, [due.lane]: run } }, job);
      this.log.log(`Автообновление запасного поставлено: ${due.lane}, ${job.id}.`);
      return { queued: true, reason: 'Заявка поставлена.' };
    } catch (error) {
      return { queued: false, reason: error instanceof Error ? error.message : String(error) };
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

  /** Кэш только для опроса экрана. POST start выполняет новый замер. */
  private async peerCached(): Promise<PeerProbe | null> {
    if (!process.env.HA_PEER_URL?.trim()) return null;
    if (this.cachedPeer && Date.now() - this.speedAt < SPEED_CACHE_MS) return this.cachedPeer;
    this.cachedPeer = await this.probePeer();
    this.speedAt = Date.now();
    return this.cachedPeer;
  }

  /** Спросить соседа по HA_PEER_URL. Нет адреса — null; не ответил — healthy:false. */
  async probePeer(verifyReady = false): Promise<PeerProbe | null> {
    const base = process.env.HA_PEER_URL?.trim().replace(/\/+$/, '');
    if (!base) return null;
    const t0 = Date.now();
    try {
      const signal = AbortSignal.timeout(4000);
      const [r, health] = await Promise.all([
        fetch(base + '/api/control/switch/ping', { signal }),
        verifyReady ? fetch(base + '/api/health/ready', { signal, redirect: 'error' }) : null,
      ]);
      const ms = Date.now() - t0;
      if (!r.ok || (health && !health.ok)) return { healthy: false, ms };
      const b = (await r.json()) as Record<string, unknown> | null;
      if (!b || typeof b !== 'object' || Array.isArray(b)) return { healthy: false, ms };
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
      domain: EMPTY_DOMAIN,
      switchReadiness: { state: 'unknown' as const, reasons: ['Переключение на этом сервере не настроено.'] },
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
    const [alive, version, peerSpeed] = await Promise.all([this.bridgeAlive(), this.appVersion(), this.peerCached()]);
    const busy = jobBusy(doc.job);
    const now = Date.now();
    const age = copyAgeMin(doc.peerCopyAt, now);
    const peerVersion = peerSpeed?.self === peerOf(self) && peerSpeed.healthy ? peerSpeed.version ?? doc.peerVersion ?? null : doc.peerVersion ?? null;
    const domain = currentDomain(doc.domain, now);
    const warning = recoveryWarning(doc, domain, alive);
    const readiness = switchReadiness(doc, self, version, alive, !!process.env.HA_PEER_URL?.trim(), now, peerSpeed);
    const config = scheduleConfig(doc, this.autoMinutes());
    return {
      blockers: readiness.reasons,
      enabled: true,
      self,
      version,
      autoRefresh: {
        enabled: config.data.enabled,
        minutes: config.revision === 0 ? this.autoMinutes() : config.data.intervalMinutes,
        lastAt: doc.scheduleRuntime?.data?.slotAttemptAt ?? null,
      },
      role: doc.role,
      mode: doc.mode,
      job: doc.job && warning ? { ...doc.job, warning } : doc.job ?? null,
      peer: {
        name: peerOf(self),
        version: peerVersion,
        copyAgeMin: age,
        healthy: doc.peerHealthy ?? null,
        checkedAt: doc.peerCheckedAt ?? null,
      },
      domain,
      switchReadiness: readiness,
      bridge: { alive },
      canStart: readiness.state === 'ready',
      canRefresh: canRefreshNow(doc.role, doc.mode, busy, alive) && !refreshDomainReason(doc, self, now, false),
      canEmergency: doc.role === 'standby' && !busy && alive,
      speed: this.speedSides(self, peerSpeed),
    };
  }

  /** Захват работы и выбранного слота одним запросом к базе. */
  private async acquire(
    doc: SwitchDoc, role: SwitchRole, direction: string,
    details: Pick<SwitchJob, 'refreshScope' | 'scheduleKeys' | 'scheduleExpiresAt'> = {},
    filters: Record<string, unknown> = {}, extra: Record<string, unknown> = {},
  ): Promise<SwitchJob> {
    const reason = idleReason(doc, role);
    if (reason) throw new ConflictException(reason);
    if (!(await this.bridgeAlive())) {
      throw new ServiceUnavailableException('Мост переключения на сервере не запущен (cron раз в минуту).');
    }
    const job: SwitchJob = {
      id: randomBytes(6).toString('hex'), direction, step: 'queued', state: 'queued',
      startedAt: new Date().toISOString(), ...details,
    };
    const result = await this.col().updateOne(
      this.filter({
        role, mode: doc.mode, 'job.id': doc.job?.id ?? null, 'job.state': { $nin: ['queued', 'running'] }, ...filters,
      }),
      { $set: { ...extra, ...refreshAttempt(job, Date.parse(job.startedAt)), job, bridgeDelivery: { jobId: job.id }, updatedAt: new Date() } } as never,
    );
    if (result.matchedCount !== 1) throw new ConflictException('Состояние сервера изменилось. Повторите операцию после обновления страницы.');
    return job;
  }

  private async failJob(doc: SwitchDoc, job: SwitchJob, reason: string, now: number, safeRetry = false) {
    const set: Record<string, unknown> = {
      'job.state': 'failed', 'job.error': reason, 'job.finishedAt': new Date(now).toISOString(),
      ...scheduleProgress(doc, job, 'failed', now, reason, undefined, safeRetry),
    };
    if (doc.role === 'main') set.mode = 'normal';
    const result = await this.col().updateOne(
      this.filter({ 'job.id': job.id, 'job.state': job.state, 'job.step': job.step, 'bridgeDelivery.token': doc.bridgeDelivery?.token ?? null }),
      { $set: set } as never,
    );
    if (result.matchedCount === 1) this.log.warn(`Переключение ${job.id}: ${reason}`);
    return result.matchedCount === 1;
  }

  /** Повторная доставка после рестарта сохраняет id той же заявки. */
  private async reconcileDelivery(doc: SwitchDoc) {
    const { job, bridgeDelivery: delivery } = doc;
    if (job?.state !== 'queued' || delivery?.jobId !== job.id || delivery.delivered) return;
    const now = Date.now();
    if (delivery.leaseUntil && Date.parse(delivery.leaseUntil) > now) return;
    const token = randomBytes(12).toString('hex');
    const lease = { jobId: job.id, token, leaseUntil: new Date(now + DELIVERY_LEASE_MS).toISOString() };
    const claim = await this.col().updateOne(
      this.filter({ 'job.id': job.id, 'job.state': 'queued', 'bridgeDelivery.token': delivery.token ?? null, 'bridgeDelivery.delivered': { $ne: true } }),
      { $set: { bridgeDelivery: lease } },
    );
    if (claim.matchedCount !== 1) return;

    let delivered: boolean;
    try {
      const expired = job.scheduleExpiresAt && Date.parse(job.scheduleExpiresAt) <= Date.now();
      delivered = expired ? (await bridgeFiles(this.dir, job.id)) === 'delivered' : await publishBridgeRequest(this.dir, job);
      if (expired && !delivered) {
        const reason = 'Время запуска по расписанию истекло до передачи заявки мосту.';
        if (await this.failJob({ ...doc, bridgeDelivery: lease }, job, reason, Date.now())) return reason;
        return;
      }
    } catch (error) {
      const reason = 'Не удалось передать заявку мосту переключения. Проверьте папку заявок.';
      if (await this.failJob({ ...doc, bridgeDelivery: lease }, job, reason, Date.now(), error instanceof RequestNotPublished)) return reason;
      return;
    }
    await this.col().updateOne(this.filter({ 'job.id': job.id, 'bridgeDelivery.token': token }), {
      $set: { bridgeDelivery: { jobId: job.id, delivered } },
    });
  }

  private async deliverQueued(doc: SwitchDoc, job: SwitchJob) {
    const reason = await this.reconcileDelivery({ ...doc, job, bridgeDelivery: { jobId: job.id } });
    if (reason) throw new ServiceUnavailableException(reason);
    return { ok: true, job };
  }

  async start() {
    const self = this.assertEnabled();
    const doc = (await this.refresh())!;
    const reason = idleReason(doc);
    if (reason) throw new ConflictException(reason);
    if (!(await this.bridgeAlive())) throw new ServiceUnavailableException('Мост переключения на сервере не запущен (cron раз в минуту).');
    const [version, probe] = await Promise.all([this.appVersion(), this.probePeer(true)]);
    const readiness = switchReadiness(doc, self, version, true, !!process.env.HA_PEER_URL?.trim(), Date.now(), probe);
    if (readiness.state !== 'ready') throw new ConflictException({ message: readiness.reasons, details: readiness });
    const job = await this.acquire(doc, 'main', self + '->' + peerOf(self), {}, {
      ...this.domainFilter(doc), peerCheckedAt: doc.peerCheckedAt, peerHealthy: true,
    });
    return this.deliverQueued(doc, job);
  }

  async emergency() {
    this.assertEnabled();
    const doc = (await this.refresh())!;
    const job = await this.acquire(doc, 'standby', 'emergency');
    return this.deliverQueued(doc, job);
  }

  /** Код и данные остаются режимом по умолчанию для прежних клиентов. */
  async refreshPeer(scope: RefreshScope = 'both') {
    const self = this.assertEnabled();
    const doc = (await this.refresh())!;
    const reason = idleReason(doc) ?? refreshDomainReason(doc, self, Date.now(), false);
    if (reason) throw new ConflictException(reason);
    const job = await this.acquire(doc, 'main', 'refresh', { refreshScope: scope }, this.domainFilter(doc));
    return this.deliverQueued(doc, job);
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
      if (dto.peer.version !== undefined && dto.peer.version !== null) set.peerVersion = dto.peer.version;
      if (dto.peer.copyAt !== undefined && dto.peer.copyAt !== null) set.peerCopyAt = dto.peer.copyAt;
      if (dto.peer.healthy !== undefined && dto.peer.healthy !== null) {
        set.peerHealthy = dto.peer.healthy;
        set.peerCheckedAt = now.toISOString();
      }
    }
    if (dto.domain) set.domain = dto.domain;
    const doc = await this.load(self);
    let conditions: Record<string, unknown> = {};
    if (dto.id === 'self') {
      if (jobBusy(doc.job)) throw new ConflictException('Идёт переключение');
      conditions = { 'job.state': { $nin: ['queued', 'running'] } };
      if (dto.role) set.role = dto.role;
      if (dto.mode) set.mode = dto.mode;
    } else if (dto.id !== 'peer') {
      const job = doc.job;
      if (!job || job.id !== dto.id) throw new ConflictException('Это отчёт о другой работе');
      if (!jobBusy(job)) throw new ConflictException('Работа уже завершена');
      const state = dto.state ?? 'running';
      const warning = dto.warning ?? (state === 'failed' ? undefined : dto.error);
      const error = state === 'failed' ? (dto.error ?? 'Переключение не удалось').slice(0, 2000) : undefined;
      const next = { ...job, step: dto.step ?? job.step, state };
      if (warning) next.warning = warning.slice(0, 2000);
      if (error) next.error = error;
      else if (state === 'running' && dto.error) next.error = dto.error.slice(0, 2000); // Совместимость прежнего экрана.
      else delete next.error;
      if (state !== 'running') next.finishedAt = now.toISOString();
      set.job = next;
      const safeRetry = state === 'failed' && dto.step === 'preflight' && ['queued', 'preflight'].includes(job.step);
      Object.assign(set, scheduleProgress(doc, job, state, now.getTime(), error, warning, safeRetry));
      if (state === 'failed' && doc.role === 'main') set.mode = 'normal';
      if (dto.role) set.role = dto.role;
      if (dto.mode) set.mode = dto.mode;
      conditions = { 'job.id': dto.id, 'job.state': job.state, 'job.step': job.step };
    }
    const result = await this.col().updateOne(this.filter(conditions), { $set: set } as never);
    if (result.matchedCount !== 1) throw new ConflictException('Работа изменилась во время отчёта');
    const fresh = (await this.col().findOne(this.filter()))!;
    this.remember(fresh);
    return { ok: true, role: fresh.role, mode: fresh.mode, job: fresh.job ?? null };
  }
}
