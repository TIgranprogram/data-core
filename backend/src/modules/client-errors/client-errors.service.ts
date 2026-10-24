import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { createHash } from 'crypto';
import { Model, Types } from 'mongoose';
import { ClientError, ClientErrorDocument, CLIENT_ERROR_TTL_DAYS } from './client-error.schema';
import { CreateClientErrorDto } from './dto/create-client-error.dto';

/** Не больше стольких записей в минуту от одного пользователя; сверх — молча мимо. */
export const CLIENT_ERROR_LIMIT_PER_MIN = 20;
const WINDOW_MS = 60_000;
/** Сколько групп отдаёт top. */
const TOP_LIMIT = 100;

/** Числа, ObjectId, uuid и длинные hex → «#», чтобы одна ошибка с разными id попадала в одну группу. */
export function normalizeForSig(s: string | undefined): string {
  return (s ?? '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '#')
    .replace(/\b[0-9a-f]{12,}\b/gi, '#')
    .replace(/\d+/g, '#')
    .trim();
}

/**
 * Вырезать query/hash-параметры из каждого адреса в строке: «/api/x?search=…», «#stock?search=…»,
 * «api.js?v=3:10:5» → «api.js:10:5» (номер строки стека сохраняется). «?» без продолжения (конец фразы) не трогаем.
 */
export function stripQuery(s: string): string {
  // параметры (есть «=») — до конца строки/кавычки, иначе незакодированный пробел оставил бы хвост поиска («?search=мой секрет»);
  // номер строки стека в конце сохраняем
  s = s.replace(/\?[^\s'"?]*=[^\n'"]*?((?::\d+){1,2}\)?)?(?=['"\n]|$)/g, '$1');
  return s.replace(/\?(?=[^\s)'"])[^\s)'"]*?((?::\d+){1,2})?(?=[\s)'"]|$)/g, '$1');
}

/** Похожее на секрет → «***»: Bearer …, kppd_…, JWT (a.b.c), длинные hex/base64 (от 32 символов, буквы и цифры). */
export function maskSecrets(s: string): string {
  return s
    .replace(/Bearer\s+[^\s'",;)]+/gi, 'Bearer ***')
    .replace(/kppd_[A-Za-z0-9_-]+/g, '***')
    .replace(/[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '***')
    .replace(/[A-Za-z0-9+/_=-]{32,}/g, (m) => (/\d/.test(m) && /[A-Za-z]/.test(m) && !m.includes('//') ? '***' : m));
}

/**
 * Сервер сам чистит отчёт (клиенту не доверяем): без параметров адресов и токенов —
 * ни в `clienterrors`, ни в журнал сервера.
 */
export function sanitizeClientError(dto: CreateClientErrorDto): CreateClientErrorDto {
  const clean = (v?: string) => (typeof v === 'string' ? maskSecrets(stripQuery(v)) : v);
  return {
    ...dto,
    message: clean(dto.message) ?? '',
    name: clean(dto.name),
    stack: clean(dto.stack),
    section: clean(dto.section),
    action: clean(dto.action),
    url: clean(dto.url),
    version: clean(dto.version),
    ua: typeof dto.ua === 'string' ? maskSecrets(dto.ua) : dto.ua,
  };
}

/** sig = хэш name + message (без чисел/id) + section + url. */
export function clientErrorSig(e: Pick<CreateClientErrorDto, 'name' | 'message' | 'section' | 'url'>): string {
  const src = [e.name ?? '', normalizeForSig(e.message), e.section ?? '', normalizeForSig(e.url)].join('|');
  return createHash('sha1').update(src).digest('hex').slice(0, 16);
}

export interface ClientErrorTopItem {
  sig: string;
  count: number;
  users: number;
  lastAt: Date;
  message: string;
  name?: string;
  section?: string;
  action?: string;
  url?: string;
  status?: number;
  version?: string;
  sampleStack?: string;
}

@Injectable()
export class ClientErrorsService {
  private readonly logger = new Logger('ClientErrors');
  /** Окно лимита по пользователю: начало минуты и счёт. В памяти процесса (один экземпляр backend). */
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(@InjectModel(ClientError.name) private readonly model: Model<ClientErrorDocument>) {}

  /** true — можно записать; false — лимит минуты исчерпан. */
  allow(userId: string, now = Date.now()): boolean {
    if (this.windows.size > 5000) {
      for (const [k, w] of this.windows) if (now - w.start >= WINDOW_MS) this.windows.delete(k);
    }
    const w = this.windows.get(userId);
    if (!w || now - w.start >= WINDOW_MS) {
      this.windows.set(userId, { start: now, count: 1 });
      return true;
    }
    if (w.count >= CLIENT_ERROR_LIMIT_PER_MIN) return false;
    w.count += 1;
    return true;
  }

  /** Записать ошибку (если не сверх лимита). Возвращает, записана ли. */
  async record(raw: CreateClientErrorDto, user: { id: string; role?: string }): Promise<boolean> {
    if (!this.allow(user.id)) return false;
    const dto = sanitizeClientError(raw);
    const sig = clientErrorSig(dto);
    const oneLine = (s?: string) => (s ?? '').replace(/\s+/g, ' ').trim();
    this.logger.warn(`[client-error] ${sig} ${oneLine(dto.section) || '-'} ${oneLine(dto.message)}`);
    await this.model.create({
      ...dto,
      sig,
      userId: new Types.ObjectId(user.id),
      role: user.role,
    });
    return true;
  }

  /** Группы ошибок за последние `hours` часов по убыванию числа. */
  async top(hoursRaw?: string): Promise<{ items: ClientErrorTopItem[] }> {
    const h = parseInt(String(hoursRaw ?? ''), 10);
    const hours = Number.isFinite(h) && h > 0 ? Math.min(h, CLIENT_ERROR_TTL_DAYS * 24) : 24;
    const since = new Date(Date.now() - hours * 3600_000);
    const items = await this.model
      .aggregate<ClientErrorTopItem>([
        { $match: { createdAt: { $gte: since } } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$sig',
            count: { $sum: 1 },
            users: { $addToSet: '$userId' },
            lastAt: { $first: '$createdAt' },
            message: { $first: '$message' },
            name: { $first: '$name' },
            section: { $first: '$section' },
            action: { $first: '$action' },
            url: { $first: '$url' },
            status: { $first: '$status' },
            version: { $first: '$version' },
            sampleStack: { $first: '$stack' },
          },
        },
        { $sort: { count: -1, lastAt: -1 } },
        { $limit: TOP_LIMIT },
        {
          $project: {
            _id: 0,
            sig: '$_id',
            count: 1,
            users: { $size: '$users' },
            lastAt: 1,
            message: 1,
            name: 1,
            section: 1,
            action: 1,
            url: 1,
            status: 1,
            version: 1,
            sampleStack: 1,
          },
        },
      ])
      .exec();
    return { items };
  }
}
