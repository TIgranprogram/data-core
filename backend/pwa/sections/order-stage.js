import { current, onChange } from '../core/router.js';
import { setCrumbTail } from '../ui/crumbs.js';

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
