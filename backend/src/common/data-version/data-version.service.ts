import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';

type Stream = { on(ev: string, fn: (x: unknown) => void): unknown; close(): Promise<void> };

/**
 * Версии данных по коллекциям (скорость С9, 2026-10-22). Поток изменений MongoDB (replica set rs0): любая запись в базу —
 * из приложения, из CRM kppdf, из синхронизации таблиц — увеличивает версию своей коллекции. Тяжёлые расчёты списков
 * (склад, паспорта, «Требуют заполнения») кэшируются по ключу «версии нужных коллекций»: пока данные не менялись —
 * ответ из памяти, изменились — расчёт заново. Потока нет (тесты, ошибка, нет прав) — кэш выключен, всё считается как раньше.
 */
@Injectable()
export class DataVersionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('DataVersion');
  private readonly ver = new Map<string, number>();
  private readonly memo = new Map<string, Promise<unknown>>();
  private epoch = 0;
  private live = false;
  private warned = false;
  private stopped = false;
  private stream?: Stream;
  private timer?: NodeJS.Timeout;

  constructor(@InjectConnection() private readonly conn: Connection) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV === 'test' || process.env.DATA_VERSION_CACHE === 'off') return;
    this.start();
  }

  async onModuleDestroy() {
    this.stopped = true; this.live = false;
    clearTimeout(this.timer);
    await this.stream?.close().catch(() => undefined);
  }

  private start() {
    if (this.stopped) return;
    try {
      const s = this.conn.db!.watch([{ $project: { ns: 1 } }]) as unknown as Stream;
      this.stream = s;
      s.on('change', (c) => { const k = (c as { ns?: { coll?: string } }).ns?.coll; if (k) this.ver.set(k, (this.ver.get(k) ?? 0) + 1); });
      s.on('error', (e) => this.fail(e as Error));
      s.on('close', () => this.fail(new Error('поток закрыт')));
      // кэш включается чуть позже: поток должен успеть открыться, иначе запись в этот миг осталась бы незамеченной
      this.timer = setTimeout(() => { this.timer = undefined; this.epoch++; this.memo.clear(); this.live = true; this.warned = false; this.log.log('кэш списков включён (поток изменений MongoDB)'); }, 3000);
    } catch (e) { this.fail(e as Error); }
  }

  private fail(e: Error) {
    const wasLive = this.live;
    this.live = false; this.memo.clear();
    if (this.stopped || (!wasLive && this.timer && this.stream === undefined)) return;
    this.stream = undefined;
    clearTimeout(this.timer);
    // предупреждение — один раз за серию сбоев, чтобы не засорять журнал (например, у пользователя Mongo нет прав на поток)
    if (!this.warned) this.log.warn(`поток изменений недоступен (${e.message}) — кэш списков выключен, повтор каждые 30 с`);
    this.warned = true;
    this.timer = setTimeout(() => { this.timer = undefined; this.start(); }, 30000);
  }

  /** Версии разделов для экрана (сумма версий их коллекций); `live: false` — поток не работает, сравнивать нечего. */
  snapshot(groups: Record<string, readonly string[]>) {
    const v = Object.fromEntries(Object.entries(groups).map(([k, colls]) => [k, colls.reduce((s, c) => s + (this.ver.get(c) ?? 0), 0)]));
    return { live: this.live, epoch: this.epoch, v };
  }

  /** Ключ «версии коллекций»; null — кэш выключен. */
  key(colls: readonly string[]): string | null {
    return this.live ? `${this.epoch}:${colls.map((c) => this.ver.get(c) ?? 0).join('.')}` : null;
  }

  /**
   * Расчёт `fn` один раз на версию данных `colls` и параметры `extra`; одновременные запросы ждут один расчёт.
   * Результат общий — вызывающий его не меняет (копирует перед сортировкой/правкой). До 40 записей, старые вытесняются.
   */
  cached<T>(scope: string, colls: readonly string[], extra: string, fn: () => Promise<T>): Promise<T> {
    const v = this.key(colls);
    if (v === null) return fn();
    const k = `${scope}|${v}|${extra}`;
    let p = this.memo.get(k) as Promise<T> | undefined;
    if (!p) {
      p = fn();
      this.memo.set(k, p);
      p.catch(() => this.memo.delete(k));
      if (this.memo.size > 40) this.memo.delete(this.memo.keys().next().value!);
    }
    return p;
  }
}
