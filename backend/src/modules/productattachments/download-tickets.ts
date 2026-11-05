import { randomBytes } from 'crypto';

/** Одноразовый тикет на скачивание файла: живёт 60 секунд, использовать можно один раз. Хранится в памяти процесса. */
export const TICKET_TTL_MS = 60_000;

export class DownloadTickets {
  private readonly map = new Map<string, { attachmentId: string; userId: string; exp: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  issue(attachmentId: string, userId: string): { ticket: string; expiresIn: number } {
    this.sweep();
    const ticket = randomBytes(24).toString('hex');
    this.map.set(ticket, { attachmentId, userId, exp: this.now() + TICKET_TTL_MS });
    return { ticket, expiresIn: TICKET_TTL_MS / 1000 };
  }

  /** Погасить тикет: вернуть файл, если тикет есть, не просрочен и выдан на этот файл. Повторный вызов — `null`. */
  consume(ticket: string, attachmentId: string): { userId: string } | null {
    const t = this.map.get(String(ticket ?? ''));
    if (!t) return null;
    this.map.delete(ticket);
    if (t.exp < this.now() || t.attachmentId !== attachmentId) return null;
    return { userId: t.userId };
  }

  private sweep() {
    const now = this.now();
    for (const [k, v] of this.map) if (v.exp < now) this.map.delete(k);
  }
}
