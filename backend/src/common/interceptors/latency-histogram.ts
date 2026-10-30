/**
 * CC-11: счётчик-гистограмма задержек API в памяти процесса.
 * На запрос — одно увеличение числа в массиве (O(1)), без записи в базу и без хранения самих запросов.
 * Раз в сутки снимок (`snapshot(true)`) уходит в `app_control_daily` и счётчик обнуляется.
 * Перезапуск процесса счётчик теряет — снимок за такие сутки помечается `partial` (см. modules/control).
 */
export const LATENCY_EDGES_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;
/** С какого времени запрос считается медленным (как SLOW_MS в slow-request.interceptor). */
const SLOW_FROM_MS = 1000;

export interface LatencySnapshot {
  /** Когда счётчик начал считать (запуск процесса или прошлый сброс). */
  since: Date;
  requests: number;
  /** Задержка, мс: верхняя граница корзины, в которую попала медиана / 95-й перцентиль. null — запросов не было. */
  p50: number | null;
  p95: number | null;
  /** Запросов не быстрее 1 с. */
  slow: number;
  /** Ответов с кодом 500 и выше. */
  errors5xx: number;
  maxMs: number;
}

export class LatencyHistogram {
  private counts = new Array<number>(LATENCY_EDGES_MS.length + 1).fill(0);
  private requests = 0;
  private slow = 0;
  private errors5xx = 0;
  private maxMs = 0;
  private since = new Date();

  observe(ms: number, status = 200): void {
    let i = 0;
    while (i < LATENCY_EDGES_MS.length && ms > LATENCY_EDGES_MS[i]) i++;
    this.counts[i]++;
    this.requests++;
    if (ms >= SLOW_FROM_MS) this.slow++;
    if (status >= 500) this.errors5xx++;
    if (ms > this.maxMs) this.maxMs = ms;
  }

  private quantile(q: number): number | null {
    if (!this.requests) return null;
    const need = Math.ceil(this.requests * q);
    let acc = 0;
    for (let i = 0; i < this.counts.length; i++) {
      acc += this.counts[i];
      if (acc >= need) return i < LATENCY_EDGES_MS.length ? LATENCY_EDGES_MS[i] : this.maxMs;
    }
    return this.maxMs;
  }

  /** Снимок; `reset` — обнулить и начать новое окно. */
  snapshot(reset = false, now = new Date()): LatencySnapshot {
    const snap: LatencySnapshot = {
      since: this.since, requests: this.requests, p50: this.quantile(0.5), p95: this.quantile(0.95),
      slow: this.slow, errors5xx: this.errors5xx, maxMs: this.maxMs,
    };
    if (reset) {
      this.counts.fill(0);
      this.requests = this.slow = this.errors5xx = this.maxMs = 0;
      this.since = now;
    }
    return snap;
  }
}

/** Один счётчик на процесс. */
export const latency = new LatencyHistogram();
