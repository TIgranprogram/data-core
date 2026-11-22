
import { api, apiBlob, apiFile, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, dateTime, newUid, qty } from '../core/format.js';
import { button, readonlyGroup, row, section, select, stack } from '../ui/kit/index.js';
import { busyBlock, failBlock } from '../ui/kit/busy.js';
import { buildForm } from '../ui/kit/form.js';
import { toggle } from '../ui/kit/guide.js';
import { modal } from '../ui/kit/dialog.js';
import { openPdfPreview } from '../ui/kit/pdf-preview.js';
import { toast, toastError } from '../ui/kit/toast.js';

const base = (order) => '/salesorders/' + encodeURIComponent(order.id) + '/archive';
export const archivedOrder = (order) => Number(order?.activeArchiveVersion) > 0;
export const canEditOrder = (order) => !archivedOrder(order) && !order.archived && session.canEditOrders
  && (order.stage !== 'closed' || session.role === 'admin');
const canClose = (order) => !archivedOrder(order) && ['ready', 'partly', 'shipped', 'closed'].includes(order.stage)
  && session.canEditOrders && session.canMoney;
const canReopen = (order) => archivedOrder(order) && session.role === 'admin' && session.canEditOrders;

function lazySection(title, load, paint, plain = false) {
  const content = stack();
  const panel = section({ title, body: content, plain });
  let started = false;
  async function refresh() {
    content.replaceChildren(busyBlock('архив'));
    try { content.replaceChildren(paint(await load())); }
    catch (error) { content.replaceChildren(failBlock(error, refresh, { text: 'Архив не открылся' })); }
  }
  panel.addEventListener('toggle', () => {
    if (!panel.open || started) return;
    started = true;
    refresh();
  });
  return panel;
}

function archiveVersion(order, version) {
  const path = base(order) + '/' + version.version;
  return lazySection('Версия ' + version.version + ' · ' + dateTime(version.archivedAt),
    () => api(path),
    (saved) => {
      const files = (saved.files || []).map((file) => {
        const url = path + '/files/' + encodeURIComponent(file.id);
        const name = file.name || 'Документ';
        const open = file.mime === 'application/pdf'
          ? () => openPdfPreview({ title: name, load: () => apiBlob(url, { fallback: name }) })
          : () => apiFile(url, { fallback: name }).catch(toastError);
        return row({ title: name, action: button({ label: file.mime === 'application/pdf' ? 'Открыть PDF' : 'Скачать', size: 'S', onClick: open }) });
      });
      return stack(
        readonlyGroup({ rows: [
          ['Договор', saved.order?.orderNo || order.orderNo],
          ['Заказчик', saved.order?.customer],
          ['Основание', version.reason],
          ['Возобновлён', version.reopenedAt && dateTime(version.reopenedAt)],
          ['Причина возобновления', version.reopenReason],
        ] }),
        ...(saved.lines || []).map((line) => row({ title: line.title || 'Позиция', meta: [line.qty == null ? '' : qty(line.qty), line.unit].filter(Boolean).join(' ') })),
        ...files);
    }, true);
}

export function orderArchiveBlock(order) {
  if (!['ready', 'partly', 'shipped', 'closed'].includes(order.stage) && !archivedOrder(order) && !order.archiveStateVersion) return null;
  return lazySection('Архив договора', () => api(base(order)),
    (history) => stack(history.items?.length
      ? history.items.map((version) => archiveVersion(order, version))
      : h('p', { class: 'muted' }, 'Архивных версий пока нет.')));
}

const reasonForm = (label) => buildForm([{ key: 'reason', type: 'textarea', rows: 2, max: 500, label, required: true, wide: true }]);

async function closeOrder(order) {
  const path = base(order);
  const docs = (order.legal?.documents || []).filter((doc) => doc.kind === 'acceptance' && doc.uid);
  const readiness = await api(path + '/readiness');
  const reason = reasonForm('Основание закрытия');
  let confirmed = false;
  const confirm = toggle({ label: 'Работы, применимый монтаж и документы по договору завершены', onChange: (checked) => { confirmed = checked; } });
  const evidence = docs.length ? select({ label: 'Акт приёмки', options: [['', 'Выберите акт'], ...docs.map((doc) => [doc.uid, [doc.number || 'Акт', date(doc.date)].filter(Boolean).join(' · ')])] }) : null;
  const checks = h('div', { 'aria-live': 'polite' });
  const lines = new Map((order.lines || []).map((line) => [line.id, line.title]));
  const paint = (state) => {
    const messages = [...new Set((state.blockers || []).map((item) => {
      const title = lines.get(item.incomeId);
      return [title, item.message].filter(Boolean).join(' · ');
    }))];
    checks.replaceChildren(messages.length ? h('ul', null, ...messages.map((message) => h('li', null, message)))
      : h('p', null, state.ready ? 'Готовность подтверждена. Проверьте основание перед закрытием.' : 'Готовность пока не подтверждена.'));
  };
  paint(readiness);
  evidence?.addEventListener('change', async () => {
    const chosen = evidence.value;
    try {
      const state = await api(path + '/readiness', { query: { evidenceDocumentUid: chosen } });
      if (evidence.value === chosen) paint(state);
    } catch (error) { toastError(error); }
  });
  const clientUid = newUid();
  const saved = await modal({
    title: 'Закрыть и архивировать договор ' + (order.orderNo || ''),
    okText: 'Закрыть и архивировать',
    body: stack(
      checks, reason.el, evidence ? h('label', { class: 'field' }, h('span', null, 'Акт приёмки'), evidence) : null,
      confirm),
    onOk: () => {
      const why = reason.get('reason').trim();
      if (why.length < 3 || !confirmed) throw new Error('Укажите основание и подтвердите выполнение договора.');
      return api(path, { method: 'POST', body: {
        reason: why, clientUid, expectedStateVersion: readiness.stateVersion,
        ...(evidence?.value ? { evidenceDocumentUid: evidence.value } : {}),
        manufactureComplete: true, servicesComplete: true, installationComplete: true, documentsComplete: true,
      } });
    },
  });
  if (saved) toast('Договор в архиве · версия ' + saved.version);
  return saved;
}

async function reopenOrder(order) {
  const path = base(order);
  const history = await api(path);
  const reason = reasonForm('Причина возобновления');
  const clientUid = newUid();
  const saved = await modal({
    title: 'Возобновить договор ' + (order.orderNo || ''),
    okText: 'Возобновить',
    body: stack(h('p', null, 'Архивная версия сохранится. Исправления появятся в рабочем договоре.'), reason.el),
    onOk: () => {
      const why = reason.get('reason').trim();
      if (why.length < 3) throw new Error('Укажите причину возобновления.');
      return api(path + '/reopen', { method: 'POST', body: { reason: why, clientUid, expectedStateVersion: history.stateVersion } });
    },
  });
  if (saved) toast('Договор возобновлён');
  return saved;
}

export function orderArchiveActions(order, reload) {
  const run = async (action) => { if (await action(order)) await reload(); };
  return [
    canClose(order) && { label: 'Закрыть и архивировать', run: () => run(closeOrder) },
    canReopen(order) && { label: 'Возобновить договор…', run: () => run(reopenOrder) },
  ].filter(Boolean);
}

