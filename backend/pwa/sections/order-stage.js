import { current, onChange } from '../core/router.js';
import { setCrumbTail } from '../ui/kit/crumbs.js';

/** Этапы заказа: отдельным файлом, чтобы экраны в стартовой сборке не тянули весь раздел «Заказы». */
export const STAGE = {
  new: { label: 'Проектирование', tone: 'primary' },
  production: { label: 'Производство', tone: 'info' },
  ready: { label: 'Готово к отгрузке', tone: 'warn' },
  partly: { label: 'Частично отгружен', tone: 'warn' },
  shipped: { label: 'Отгружен', tone: 'ok' },
  closed: { label: 'Закрыт', tone: 'dim' },
  cancelled: { label: 'Отменён', tone: 'danger' },
};

/** Хвост крошек «Заказ № … › Договор … › Позиция N»; панель закрыли (нет `open` в адресе) — хвост убирается. */
let offTail = null;
export function crumbTrail(parts) {
  setCrumbTail((parts || []).filter(Boolean).join(' › '));
  if (offTail) return;
  offTail = onChange(() => {
    if (current().params.open) return;
    setCrumbTail(null);
    offTail?.(); offTail = null;
  });
}

/** Этап договора цветом вкладки (вместо полосы этапов, 2026-11-08): пройдено — зелёная, идёт сейчас — жёлтая, впереди — без цвета. */
const TAB_FLOW = ['design', 'work', 'stock', 'ship', 'pass'];
const TAB_NOW = { new: 'design', production: 'work', ready: 'stock', partly: 'ship', shipped: 'pass', closed: '' };
export function tabTone(o, key) {
  const i = TAB_FLOW.indexOf(key);
  if (i < 0 || !(o.stage in TAB_NOW)) return {};
  const now = TAB_NOW[o.stage] ? TAB_FLOW.indexOf(TAB_NOW[o.stage]) : TAB_FLOW.length;
  if (i < now) return { tone: 'ok', title: 'Этап пройден' };
  if (i === now) return { tone: 'warn', title: 'Этап сейчас: ' + (STAGE[o.stage]?.label || '') };
  return {};
}
