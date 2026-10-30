import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { ParamKind, QOption, Severity } from './question.types';
import { SEVERITIES } from './question.types';

export const DAY = 86_400_000;
/** Сколько новых вопросов в сутки может прислать один источник (POST). */
export const NEW_PER_SOURCE_PER_DAY = 20;
/** Сколько вопросов может быть открыто всего; сверх — один сводный. */
export const OPEN_MAX = 200;
/** «Отложить» не больше двух раз. */
export const SNOOZE_MAX = 2;
/** Дольше месяца ИИ-вопрос без данных сам истекает. */
export const AI_EXPIRE_DAYS = 30;
/** «Ждёт агента» — неделя, потом вопрос возвращается человеку. */
export const AGENT_WAIT_DAYS = 7;
/** Сколько секунд действие считается выполняющимся, прежде чем сработает проверка зависшего. */
export const LEASE_SEC = 120;
/** Больше стольких документов кнопкой не трогаем: снимок «до» не должен раздуваться. */
export const TOUCHED_MAX = 2000;

const sha1 = (s: string) => createHash('sha1').update(s).digest('hex');

/** JSON с отсортированными ключами: одно и то же содержимое — один и тот же текст. */
export function stableJson(v: unknown): string {
  return JSON.stringify(v, (_k, x: unknown) => {
    if (x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Date) && !(x instanceof Types.ObjectId)) {
      const o = x as Record<string, unknown>;
      return Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
    }
    return x;
  });
}

export const hashOf = (v: unknown) => sha1(stableJson(v)).slice(0, 16);

/** key = sha1(type + subject.kind + отсортированные ids + версия правила). */
export function questionKey(type: string, kind: string, ids: string[], ruleV: number): string {
  return sha1([type, kind, [...ids].map(String).sort().join(','), ruleV].join('|'));
}

export const severityRank = (s: Severity) => SEVERITIES.indexOf(s) + 1;
export const bumpSeverity = (s: Severity): Severity => SEVERITIES[Math.min(SEVERITIES.indexOf(s) + 1, SEVERITIES.length - 1)];

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export const normName = (s: unknown) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Параметры действия: проверяем по схеме, лишнее отбрасываем. Ошибки — по-русски. */
export function checkParams(schema: Record<string, ParamKind>, raw: unknown): Record<string, unknown> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, kind] of Object.entries(schema)) {
    const v = r[k];
    if (typeof v !== 'string' || !v.trim()) throw new BadRequestException(`Не указан параметр действия «${k}»`);
    if (kind === 'oid' && !/^[0-9a-f]{24}$/i.test(v)) throw new BadRequestException(`Параметр «${k}» указан неверно`);
    out[k] = v.trim().slice(0, 200);
  }
  return out;
}

/** Стандартные кнопки любого вопроса. */
export const DISMISS_OPTION: QOption = { code: 'dismiss', label: 'Не проблема', risk: 'safe' };
export const SNOOZE_OPTION: QOption = { code: 'snooze', label: 'Отложить до даты', risk: 'safe' };

/** Число со словом: 1 запись, 2 записи, 5 записей. */
export const plural = (n: number, f: [string, string, string]) =>
  `${n} ${n % 10 === 1 && n % 100 !== 11 ? f[0] : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? f[1] : f[2]}`;
