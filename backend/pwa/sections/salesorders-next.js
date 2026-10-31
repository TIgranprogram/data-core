// «Что дальше» по заказу для карточки доски (ORDERS-BOARD). Чистая функция, без DOM.
// Возвращает { text, tone, btn?: { label, href | stage } }; stage — смена этапа (кнопка только при праве правки).
const q = encodeURIComponent;

/** Счётчики с сервера (могут отсутствовать — тогда считаем нулём). */
export function orderCounts(r) {
  const c = r?.counts || {};
  return {
    unassigned: Number(r?.unassignedCount) || 0,
    design: Number(c.design) || 0,
    requests: Number(c.requests) || 0,
    work: Number(c.inWork ?? c.work) || 0,
    reserved: Number(c.reservations ?? c.reserved) || 0,
    shipments: Number(c.shipments) || 0,
  };
}

export function isLate(r, today = new Date().toISOString().slice(0, 10)) {
  const d = r?.deadline || r?.shipDate;
  return !!d && !['shipped', 'closed', 'cancelled'].includes(r.stage) && String(d).slice(0, 10) < today;
}

export function nextStep(r) {
  const k = q(r.key || r.id || '');
  const n = orderCounts(r);
  const open = { label: 'Открыть заказ', href: `#salesorders?open=${k}` };
  let s;
  if (r.stage === 'new' && !r.lineCount) s = { text: 'Добавьте позиции', tone: 'neg', btn: open };
  else if (n.unassigned > 0 && ['new', 'production'].includes(r.stage)) s = { text: `Распределите ${n.unassigned} поз.: выберите изделие или услугу`, tone: 'neg', btn: { label: 'Распределить', href: `#salesorders?open=${k}` } };
  else if (r.stage === 'new' && n.design > 0) s = { text: `Проектирование: ${n.design} задач в работе`, tone: 'muted', btn: { label: 'В проектирование', href: `#design?q=${k}` } };
  else if (r.stage === 'new') s = { text: 'Можно запускать в производство', tone: 'ok', btn: { label: 'В производство', stage: 'production' } };
  else if (r.stage === 'production' && n.requests > 0) s = { text: `Ждём материалы: ${n.requests} заявок`, tone: 'muted', btn: { label: 'Заявки', href: `#requests?q=${k}` } };
  else if (r.stage === 'production' && n.work > 0) s = { text: `Изготовление: ${n.work} заданий в работе`, tone: 'muted', btn: { label: 'Работа', href: `#work?q=${k}` } };
  else if (r.stage === 'production' && r.readiness?.ready) s = { text: 'Всё готово — отметьте готовность к отгрузке', tone: 'ok', btn: { label: 'Готов к отгрузке', stage: 'ready' } };
  else if (r.stage === 'production') s = { text: 'Не готово: см. «Готовность» в заказе', tone: 'muted', btn: open };
  else if (r.stage === 'ready') s = { text: 'Оформите отгрузку', tone: 'muted', btn: { label: 'Отгрузка', href: `#salesorders?open=${k}&tab=ship` } };
  else if (r.stage === 'partly') s = { text: 'Отгружено частично — досдайте остаток', tone: 'muted', btn: { label: 'Отгрузка', href: `#salesorders?open=${k}&tab=ship` } };
  else if (r.stage === 'shipped') s = { text: 'Отгружено. Проверьте паспорта и оплату, затем завершите', tone: 'muted', btn: { label: 'Завершить заказ', stage: 'closed' } };
  else s = { text: '', tone: 'muted' };
  if (r.stagesDiffer && s.text) s.text += ' (у договоров разные этапы)';
  if (r.priority === 'urgent' && isLate(r)) s.late = 'Срок прошёл';
  return s;
}
