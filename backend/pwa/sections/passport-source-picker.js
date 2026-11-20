import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { current, onChange } from '../core/router.js';
import * as kit from '../ui/kit/index.js';
import { busyBtn } from '../ui/kit/busy.js';

export const sourcePath = (orderId, incomeId) => `/passports/order/${orderId}/lines/${incomeId}/source`;
export const readPassportSource = (orderId, incomeId) => api(sourcePath(orderId, incomeId));
export const attachmentSource = (view) => view?.source === 'attachment' || view?.selection?.mode === 'attachment';

/** Единственный PUT выбора; baseline никогда не подменяется после конфликта. */
export async function savePassportSource(orderId, incomeId, view, file = null) {
  return api(sourcePath(orderId, incomeId), { method: 'PUT', body: {
    mode: file ? 'attachment' : 'site', expectedRevision: view.selection.revision, contextToken: view.contextToken,
    ...(file ? { attachmentId: file.id, expectedAttachmentGeneration: file.selectionGeneration, confirm: true } : {}),
  } });
}

export async function useFileAsPassport(orderId, incomeId, file, { view, onSaved } = {}) {
  const baseline = view || await readPassportSource(orderId, incomeId);
  const history = baseline.sitePassports?.some((p) => p.status === 'issued');
  if (!await kit.confirmDlg('Использовать как паспорт?', `Подтверждаю, что «${file.originalName || file.name}» — паспорт этой позиции.${history ? ' Паспорт сайта останется в истории.' : ''}`, { okText: 'Использовать как паспорт' })) return false;
  const saved = await savePassportSource(orderId, incomeId, baseline, file);
  window.dispatchEvent(new Event('data-changed'));
  await onSaved?.(saved);
  return true;
}

export async function downloadSelectedPassport(orderId, incomeId, view) {
  const r = await api(`${sourcePath(orderId, incomeId)}/download-ticket`, { method: 'POST', body: { contextToken: view.contextToken } });
  const a = h('a', { href: PREFIX + r.url, download: view.attachment?.originalName || 'Паспорт' });
  document.body.append(a); a.click(); a.remove();
}

export function selectedPassportActions(orderId, incomeId, view, { reload, editable = false, parent } = {}) {
  const available = (view.effectiveState || view.state) === 'attached' && view.attachment?.available === true;
  const run = (label, fn) => kit.button({ label, size: 'S', kind: 'ghost', onClick: async (e) => {
    const end = busyBtn(e.currentTarget, null);
    try { await fn(); } catch (err) { kit.toastError(err); await reload?.(); } finally { end(); }
  } });
  return kit.stack(
    kit.row({ title: available ? 'Вложенный паспорт' : 'Вложенный паспорт недоступен',
      meta: [view.attachment?.originalName, ...(available ? [] : view.missing || ['Выберите доступный файл заново.'])].filter(Boolean).join(' · '),
      side: kit.badge(available ? 'готов' : 'нужен файл', available ? 'ok' : 'warn'), wrap: true }),
    kit.actions(available ? run('Скачать паспорт', () => downloadSelectedPassport(orderId, incomeId, view)) : null,
      editable ? kit.button({ label: 'Выбрать другой файл', size: 'S', kind: 'ghost', onClick: (e) => openPassportSourcePicker(orderId, incomeId, { parent: parent || e.currentTarget.closest('.drawer'), onSaved: reload }) }) : null,
      editable ? run('Использовать паспорт с сайта', async () => {
        if (!await kit.confirmDlg('Вернуться к паспорту с сайта?', 'Выбор вложенного паспорта будет отменён. Файл и ранее выпущенные паспорта сохранятся. Автоматического выпуска не будет.', { okText: 'Использовать с сайта' })) return;
        await savePassportSource(orderId, incomeId, view);
        window.dispatchEvent(new Event('data-changed')); await reload?.();
      }) : null));
}

/** Правая вложенная панель: контекст позиции известен, повторного вопроса об изделии нет. */
export function openPassportSourcePicker(orderId, incomeId, { parent, onSaved } = {}) {
  const route = current();
  const content = h('div');
  let handle, page = 1, writing = false;
  const load = async () => {
    content.replaceChildren(kit.busyBlock('доступные вложения', { retry: load }));
    try {
      const [view, list] = await Promise.all([readPassportSource(orderId, incomeId), api(`${sourcePath(orderId, incomeId)}/candidates`, { query: { page, limit: 20 } })]);
      if (!content.isConnected) return;
      content.replaceChildren(kit.stack(kit.hint('Выберите файл, который является паспортом этой позиции. Вложенные паспорта скачиваются отдельно и не входят в PDF сайта.'),
        ...(list.items || []).map((file) => kit.section({ title: file.originalName, sub: file.typeName, open: true, plain: true,
          body: [!file.available ? kit.hint(file.unavailableReason || 'Файл недоступен', 'warn') : null,
            kit.actions(kit.button({ label: 'Использовать как паспорт', size: 'S', disabled: !file.available, onClick: async (e) => {
              if (writing) return;
              writing = true; const end = busyBtn(e.currentTarget, null);
              try { if (await useFileAsPassport(orderId, incomeId, file, { view, onSaved })) { stop(); handle.close(); } }
              catch (err) { kit.toastError(err); if (err.status === 409) await load(); }
              finally { writing = false; end(); }
            } }))] })),
        !list.items?.length ? kit.empty({ title: 'Доступных вложений нет', hint: 'Загрузите паспорт в «Вложения» позиции, затем откройте выбор снова.' }) : null,
        kit.actions(page > 1 ? kit.button({ label: 'Назад', size: 'S', onClick: () => { page--; load(); } }) : null,
          page * list.limit < list.total ? kit.button({ label: 'Далее', size: 'S', onClick: () => { page++; load(); } }) : null)));
    } catch (err) { content.replaceChildren(kit.failBlock(err, load, { text: 'Вложения не загрузились' })); }
  };
  const stop = onChange(({ section, params }) => {
    if (section !== route.section || params.of !== route.params.of || params.open !== route.params.open) { stop(); handle.close(); }
  });
  handle = kit.openCard({ id: 'passport-source', title: 'Выбрать вложенный паспорт', popout: false,
    get: async () => ({}), canEdit: () => false,
    card: { noHistory: true, view: () => [], extra: () => { load(); return content; } },
  }, { id: incomeId, parent }, { changed() {}, close() { stop(); } });
  return handle;
}
