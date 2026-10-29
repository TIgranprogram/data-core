import { api } from '../core/api.js';
import { toast } from '../ui/toast.js';
import { errText } from '../ui/errors.js';
import { resetDictOptions } from '../ui/dict-options.js';

/** Справочники для форм и фильтров (поставщики, категории, «кто подал»): кэш 60 с, сброс после сохранения. */
let cache = null; let born = 0;
export function lookups() {
  if (cache && Date.now() - born > 60000) cache = null; // 60 с: чужие правки справочников видны без перезагрузки
  if (!cache) born = Date.now();
  cache ??= api('/supply/lookups').catch((e) => { cache = null; throw e; });
  return cache;
}
lookups.reset = () => { cache = null; resetDictOptions(); };

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
