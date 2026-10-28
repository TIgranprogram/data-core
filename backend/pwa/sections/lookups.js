import { api } from '../core/api.js';
import { toast } from '../ui/toast.js';
import { errText } from '../ui/errors.js';

/** Справочники для форм и фильтров (поставщики, категории, «кто подал»): один запрос на сессию, сброс после сохранения. */
let cache = null;
export function lookups() {
  cache ??= api('/supply/lookups').catch((e) => { cache = null; throw e; });
  return cache;
}
lookups.reset = () => { cache = null; };

/** Пункт «Создать «текст»» под списком поставщика/заказчика: только когда что-то введено и точного совпадения нет. POST /partners, затем справочник обновляется. */
export function partnerAction(kind, text, names, onDone) {
  const t = String(text || '').trim();
  if (t.length < 2 || (names || []).some((n) => String(n).trim().toLowerCase() === t.toLowerCase())) return [];
  const who = kind === 'customer' ? 'заказчика' : 'поставщика';
  return [{ label: `Создать «${t}»`, run: async () => {
    try {
      await api('/partners', { method: 'POST', body: { kind, name: t } });
      lookups.reset(); onDone?.(t);
      toast(`Контрагент «${t}» добавлен`);
    } catch (e) { if (e.status === 409) { onDone?.(t); return; } toast('Не удалось создать ' + who + ': ' + errText(e), { error: true }); }
  } }];
}

export const UNITS = ['шт', 'м', 'м²', 'м³', 'кг', 'т', 'л', 'уп', 'компл', 'рул', 'лист', 'пог. м'];

/** Единицы для выпадающего списка: из «Справочников» (СП.5), пока он пуст — обычный набор. */
export const unitList = (lk) => (lk?.units?.length ? lk.units : UNITS);
