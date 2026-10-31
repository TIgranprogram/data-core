import { ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import type { Connection } from 'mongoose';
import path from 'path';
import type { SwitchReportDto } from './switch.dto';
import {
  CACHE_MS, COL_STATE, STATE_ID, copyAgeMin, defaultRole, jobBusy, parseSelf, peerOf, secretMatches, staleReason,
  type SwitchDoc, type SwitchJob, type SwitchMode, type SwitchRole, type SwitchSelf,
} from './switch.rules';

/** Мост «живой», если трогал файл `alive` не позже, чем 3 минуты назад (cron раз в минуту). */
const BRIDGE_ALIVE_MS = 3 * 60_000;

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
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

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

  async status() {
    const self = this.assertEnabled();
    const doc = (await this.refresh())!;
    const alive = await this.bridgeAlive();
    const busy = jobBusy(doc.job);
    return {
      enabled: true,
      self,
      role: doc.role,
      mode: doc.mode,
      job: doc.job ?? null,
      peer: {
        name: peerOf(self),
        version: doc.peerVersion ?? null,
        copyAgeMin: copyAgeMin(doc.peerCopyAt, Date.now()),
        healthy: doc.peerHealthy ?? null,
        checkedAt: doc.peerCheckedAt ?? null,
      },
      bridge: { alive },
      canStart: doc.role === 'main' && doc.mode === 'normal' && !busy && alive,
      canEmergency: doc.role === 'standby' && !busy && alive,
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
  private async writeRequest(job: SwitchJob, kind: 'switch' | 'emergency') {
    const file = path.join(this.dir, 'request');
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, `id=${job.id}\nkind=${kind}\nrequestedAt=${job.startedAt}\n`, { mode: 0o644 });
    await fs.rename(tmp, file);
  }

  private async queue(role: SwitchRole, direction: string, kind: 'switch' | 'emergency') {
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
