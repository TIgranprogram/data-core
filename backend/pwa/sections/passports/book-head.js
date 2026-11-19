import { h } from '../../core/dom.js';
import { confirmDlg } from '../../ui/kit/dialog.js';
import { button, badge, iconButton, segmented } from '../../ui/kit/index.js';
import { toast } from '../../ui/kit/toast.js';
import { heading, statusOf } from './common.js';
import { openBookSample, previewPassport, printDialog } from './dialogs.js';
import { bookVariants, variantName } from './book-template.js';
import { forgetBookIssue, issueBookTemplate, pendingBookIssue } from './book-issue.js';

export function paintBookHead(head, {
  S, position, can, zoom, run, switchTemplate, changeInstanceVariant,
  showInstance, issueInstance, isMounted, requestClose, openTemplate, returnToInstance,
}) {
  const r = S.r;
  const tpl = S.template;
  const issued = statusOf(r) === 'issued';
  const variant = tpl?.variant || (r.presentationVersion === 1 ? r.variant : null);
  const confirmVariant = async (next) => {
    if (next === variant) return;
    if (!(await confirmDlg('Изменить формат черновика?', `Документ будет собран в варианте «${variantName(next)}».`, { okText: 'Изменить формат' }))) return;
    await changeInstanceVariant(next);
  };
  const formats = tpl || (can() && !issued && r.presentationVersion === 1) ? segmented({
    items: bookVariants, value: variant, fit: true, label: 'Вариант паспорта',
    onChange: (next) => {
      formats.set(variant);
      if (next === variant) return;
      run(formats.buttons.find((btn) => btn.dataset.key === next), null, async () => {
        if (!tpl) { await confirmVariant(next); return; }
        await switchTemplate(tpl.productId, next);
      });
    },
  }) : null;
  const retry = tpl && pendingBookIssue(tpl, position);
  const ready = r.readiness?.ready;
  const primary = !can() || (tpl && returnToInstance) ? null : tpl
    ? button({ label: retry?.complete ? 'Открыть паспорт' : retry ? 'Продолжить выпуск' : 'Выпустить паспорт', kind: 'primary', size: 'S',
      disabled: !ready && !retry,
      title: ready || retry ? undefined : 'Заполните то, что указано слева в «Сначала»',
      onClick: (e) => run(e.currentTarget, 'Выпускаю…', async () => {
        const x = await issueBookTemplate(tpl, position, isMounted);
        if (x) { await showInstance(x); forgetBookIssue(tpl, position); }
      }) })
    : button({ label: 'Выпустить', kind: 'primary', size: 'S', disabled: r.presentationVersion === 1 && ready === false, onClick: (e) => run(e.currentTarget, 'Выпускаю…', async () => {
      if (!(await confirmDlg('Выпустить паспорт?', 'Паспорт получит номер и гарантийный талон.', { okText: 'Выпустить' }))) return;
      const x = await issueInstance(r);
      toast('Выпущен паспорт № ' + x.passportNumber);
      await showInstance(x);
    }) });
  const art = String(r.article || '').trim();
  const name = r.name || tpl?.product?.name;
  head.replaceChildren(
    h('h2', null, tpl ? 'Шаблон паспорта' : heading(r), name ? ' · ' + name : '', ' ',
      tpl ? null : badge(issued ? 'выпущен' : statusOf(r) === 'annulled' ? 'аннулирован' : 'черновик', issued ? 'ok' : 'warn'),
      !tpl && !formats ? badge(variantName(variant) || 'Старый образец', 'dim') : null),
    h('div', { class: 'bk-sku', title: 'Артикул изделия' },
      art ? ['Артикул ', h('b', null, art)] : h('span', { class: 'muted' }, 'Артикул не задан'),
      tpl && position ? h('span', null, ' · ', [position.orderNo && 'заказ № ' + position.orderNo,
        position.lineNo != null && 'поз. ' + position.lineNo].filter(Boolean).join(' · ') || 'Позиция заказа') : null),
    h('div', { class: 'bk-acts' },
      r.printSource === 'file' || r.printFile?.hasFile ? h('span', { class: 'bk-mark' }, 'К номеру прикреплён свой PDF — печать отдаёт его. ') : null,
      formats?.el,
      tpl ? button({ label: 'Обновить', size: 'S', kind: 'ghost', title: 'Перечитать шаблон после изменений в справочниках',
        onClick: (e) => run(e.currentTarget, null, () => switchTemplate(tpl.productId, tpl.variant)) }) : null,
      returnToInstance ? button({ label: 'Вернуться к черновику', size: 'S', kind: 'primary',
        onClick: (e) => run(e.currentTarget, 'Открываю…', returnToInstance) }) : null,
      !tpl && can() && r.productId ? button({ label: 'Шаблон изделия', size: 'S', kind: 'ghost',
        onClick: (e) => run(e.currentTarget, 'Открываю…', openTemplate) }) : null,
      button({ label: S.fit ? '100 %' : 'По ширине', size: 'S', kind: 'ghost', onClick: () => zoom(!S.fit) }),
      tpl ? button({ label: 'Образец', size: 'S', disabled: !r.passportCategory,
        onClick: (e) => run(e.currentTarget, null, () => openBookSample(tpl.productId, tpl.variant)) }) : null,
      tpl ? button({ label: 'Буклет образца', kind: 'ghost', size: 'S', disabled: !r.passportCategory,
        onClick: (e) => run(e.currentTarget, 'Готовлю…', () => previewPassport(tpl.productId, {
          mode: 'print', pack: 'passport', variant: tpl.variant, presentationVersion: 1,
        })) }) : button({ label: 'Скачать PDF', size: 'S', onClick: (e) => run(e.currentTarget, null, () => printDialog(S.r)) }),
      primary,
      iconButton({ icon: '✕', label: 'Закрыть книжку', title: 'Закрыть книжку — только этой кнопкой', cls: 'k-close', onClick: requestClose })));
}
