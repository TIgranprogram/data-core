import { BadRequestException, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { openSectionsFor, sectionOpen } from '../../common/app-sections';
import { stripMoney } from '../../common/interceptors/money-mask.interceptor';
import { canSeeMoney } from '../../common/roles-hierarchy';
import { FillAuditService } from '../fill-audit/fill-audit.service';
import { FinanceService } from '../finance/finance.service';
import { PartnersService } from '../partners/partners.service';
import { SalesOrdersService } from '../salesorders/salesorders.service';
import { StockService } from '../stock/stock.service';
import { SupplyService } from '../supply/supply.service';
import { TodayService } from '../today/today.service';
import { TOOL_RESULT_MAX } from './assistant.config';

export interface ToolUser { id?: string; role?: string; isOwner?: boolean }
interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Раздел «Рабочего места», который должен быть открыт роли; 'money' — ещё и право на деньги. */
  section?: string;
}

type Row = Record<string, unknown>;
const str = (description: string) => ({ type: 'string', description });
const obj = (properties: Record<string, unknown>) => ({ type: 'object', properties, additionalProperties: false });

/** Только чтение. Новый инструмент: описание тут + ветка в `call`. Запись у помощника появится только через карточку (этап 2). */
export const TOOL_DEFS: ToolDef[] = [
  { name: 'today', section: 'home', description: 'Лента дел на сегодня и неделю: поставки, отгрузки, сроки проектирования, вопросы, платежи; показатели.', input_schema: obj({ days: { type: 'integer', description: 'Горизонт недели, 1–31 (по умолчанию 7)' } }) },
  { name: 'search_counterparties', section: 'partners', description: 'Найти поставщиков и заказчиков по названию, ИНН, телефону или почте.', input_schema: obj({ query: str('Что искать') }) },
  { name: 'search_materials', section: 'stock', description: 'Найти позицию склада по названию или артикулу: остаток и свободное количество.', input_schema: obj({ query: str('Что искать') }) },
  { name: 'list_supply_requests', section: 'requests', description: 'Заявки снабжения: поиск и фильтр по статусу (requested, in_progress, ordered, received, cancelled).', input_schema: obj({ search: str('Слова из названия, номера, поставщика'), status: str('Статус или несколько через запятую'), limit: { type: 'integer', description: 'Сколько вернуть, до 20' } }) },
  { name: 'get_sales_order', section: 'salesorders', description: 'Заказ покупателя: шапка, позиции, заявки и движения склада под него. Найти по номеру или заказчику.', input_schema: obj({ query: str('Номер заказа, производственный номер или заказчик'), id: str('Внутренний id заказа, если он уже известен из прошлого ответа') }) },
  { name: 'finance_summary', section: 'money', description: 'Деньги: сводка доходов и расходов за период или прогноз платежей. Только для денежных ролей.', input_schema: obj({ kind: { type: 'string', enum: ['summary', 'forecast'], description: 'summary — по месяцам; forecast — вперёд' }, from: str('Начало периода ГГГГ-ММ-ДД'), to: str('Конец периода ГГГГ-ММ-ДД'), days: { type: 'integer', description: 'Для forecast: 7–180' } }) },
  { name: 'data_gaps', description: 'Проверка полноты данных: что не заполнено (ИНН, цены, категории, сроки) и где это исправить.', input_schema: obj({ only: str('Ключ одной группы из прошлого ответа (необязательно)') }) },
];

/** Что режет ответ инструмента: тяжёлые и служебные поля, длинные строки и списки. */
const DROP = new Set(['photo', 'photos', 'photoIds', 'materialPhoto', 'thumb', 'storageUrl', 'passportSpec', 'sheetExtra', '__v']);
export function compact(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined || typeof v === 'number' || typeof v === 'boolean') return v;
  if (typeof v === 'string') return v.length > 300 ? v.slice(0, 300) + '…' : v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (depth > 6) return undefined;
  if (Array.isArray(v)) return v.slice(0, 30).map((x) => compact(x, depth + 1));
  if (typeof v !== 'object') return undefined;
  if ((v as { _bsontype?: string })._bsontype) return String(v);
  const o = v as Row;
  const out: Row = {};
  for (const [k, x] of Object.entries(o)) {
    if (DROP.has(k) || (k === '_id' && 'id' in o)) continue;
    out[k] = compact(x, depth + 1);
  }
  return out;
}

const pick = (o: Row, keys: string[]): Row => Object.fromEntries(keys.filter((k) => o[k] !== undefined && o[k] !== null && o[k] !== '').map((k) => [k, o[k]]));
const words = (s: unknown) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);

/**
 * Инструменты помощника: вызывают наши сервисы в процессе от имени пользователя.
 * Доступ — по открытым разделам роли; деньги не-денежной роли вырезаются здесь же (интерцептор в обход контроллера не работает).
 */
@Injectable()
export class AssistantTools {
  constructor(
    private readonly today: TodayService,
    private readonly partners: PartnersService,
    private readonly stock: StockService,
    private readonly supply: SupplyService,
    private readonly orders: SalesOrdersService,
    private readonly finance: FinanceService,
    private readonly audit: FillAuditService,
  ) {}

  /** Описания инструментов, доступных этому пользователю. */
  definitions(user: ToolUser): Array<Record<string, unknown>> {
    const open = openSectionsFor(user);
    return TOOL_DEFS.filter((t) => this.allowed(t, user, open)).map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema }));
  }

  private allowed(t: ToolDef, user: ToolUser, open: Set<string> | null): boolean {
    if (t.section === 'money') return canSeeMoney(user) && sectionOpen(open, 'money');
    return !t.section || sectionOpen(open, t.section);
  }

  /** Выполнить инструмент; результат — JSON-текст для модели (не длиннее TOOL_RESULT_MAX). Ошибки бросает наверх. */
  async run(name: string, input: Row, user: ToolUser): Promise<string> {
    const def = TOOL_DEFS.find((t) => t.name === name);
    if (!def || !this.allowed(def, user, openSectionsFor(user))) throw new BadRequestException('Этот инструмент вам недоступен');
    let data = await this.call(name, input ?? {}, user);
    if (!canSeeMoney(user)) data = stripMoney(data);
    const text = JSON.stringify(compact(data));
    return text.length > TOOL_RESULT_MAX ? text.slice(0, TOOL_RESULT_MAX) + '…[обрезано]' : text;
  }

  private async call(name: string, i: Row, user: ToolUser): Promise<unknown> {
    const open = openSectionsFor(user);
    switch (name) {
      case 'today':
        return this.today.get(user, { days: i.days });
      case 'search_counterparties': {
        const search = String(i.query ?? '').trim();
        if (!search) throw new BadRequestException('Укажите, что искать');
        const [sup, cust] = await Promise.all([this.partners.list({ type: 'supplier', search }), this.partners.list({ type: 'customer', search })]);
        const keys = ['name', 'kind', 'inn', 'phone', 'email', 'requests', 'orders', 'activeOrders', 'lastDate', 'sum'];
        return {
          suppliers: (sup.items as Row[]).slice(0, 10).map((x) => pick(x, keys)),
          customers: (cust.items as Row[]).slice(0, 10).map((x) => pick(x, keys)),
          found: sup.total + cust.total,
        };
      }
      case 'search_materials': {
        const tk = words(i.query);
        if (!tk.length) throw new BadRequestException('Укажите, что искать');
        const { items } = await this.stock.lookup();
        const hit = (items as Row[]).filter((m) => { const h = words(`${m.name} ${m.article ?? ''}`).join(' '); return tk.every((t) => h.includes(t)); });
        return { items: hit.slice(0, 15).map((m) => pick(m, ['name', 'article', 'unit', 'categoryName', 'quantity', 'free'])), found: hit.length };
      }
      case 'list_supply_requests': {
        const q: Row = { search: i.search, limit: Math.min(20, Math.max(1, Number(i.limit) || 10)), page: 1 };
        // «оплачено» — деньги: без права фильтр по нему не применяется (как в MoneyMaskInterceptor)
        if (i.status) q.status = canSeeMoney(user) ? i.status : String(i.status).split(',').filter((s) => s.trim() !== 'paid').join(',') || undefined;
        const res = await this.supply.list(q);
        const keys = ['num', 'title', 'qty', 'unit', 'statusLabel', 'supplierName', 'companyName', 'orderLabel', 'neededBy', 'requestDate', 'invoiceNo', 'requestedBy', 'priceHint'];
        return { items: (res.items as Row[]).map((x) => pick(x, keys)), total: res.total, counts: res.counts };
      }
      case 'get_sales_order': {
        const see = { requests: sectionOpen(open, 'requests'), stock: sectionOpen(open, 'stock') };
        let id = String(i.id ?? '');
        if (!Types.ObjectId.isValid(id)) {
          const search = String(i.query ?? '').trim();
          if (!search) throw new BadRequestException('Укажите номер заказа или заказчика');
          const found = await this.orders.list({ search, limit: 5, filter: 'all' });
          const list = found.items as Row[];
          if (list.length !== 1) return { found: found.total, candidates: list.map((x) => pick(x, ['id', 'orderNo', 'productionNo', 'customer', 'title', 'stageLabel', 'shipDate'])) };
          id = String(list[0].id);
        }
        return this.orders.get(id, see);
      }
      case 'finance_summary': {
        const q = { from: i.from, to: i.to, days: i.days };
        return i.kind === 'forecast' ? this.finance.forecast(q) : this.finance.summary(q);
      }
      case 'data_gaps':
        return this.audit.report(user, { limit: 10, only: i.only ? String(i.only) : undefined });
      default:
        throw new BadRequestException('Неизвестный инструмент');
    }
  }
}
