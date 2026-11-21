import { api, apiFile } from '../core/api.js';
import { h } from '../core/dom.js';
import { go } from '../core/router.js';
import { plural } from '../core/format.js';
import * as kit from '../ui/kit/index.js';
import { busyBtn } from '../ui/kit/busy.js';
import { canWorkPassport as canEdit } from './passports/common.js';
import { ORDER_FORMATS, printQuery } from './passports/print-options.js';
import { displayName } from './passports/fill/model.js';
import { bookVariants, variantName } from './passports/book-template.js';
import { missingCount, shortMissing, summaryText } from './order-passport-text.js';
import { attachmentSource, selectedPassportActions, openPassportSourcePicker } from './passport-source-picker.js';

/*
 * ПНЗ.2 / C075: правая панель «Паспорта заказа» (of=orderpass&open=<orderId>).
 * План и выпуск v1. Выбранный вариант относится к новым экземплярам.
 */
const STATE = { issued: ['Выпущен', 'ok'], ready: ['Готов к выпуску', 'info'], blocked: ['Не хватает данных', 'warn'] };
/** Выбранная фирма, если в заказ записать не удалось (нет права): живёт, пока панель открыта. */
const pickedFirm = new Map();

const firmOnly = (l) => (l.missing || []).length > 0 && (l.missing || []).every((m) => /фирм/i.test(String(m)));
const pickOf = (orderId) => pickedFirm.get(String(orderId)) || null;

/** Открыть панель: из «По заказам» и из карточки заказа. */
export const openOrderPassports = (orderId) => go('docs', { tab: 'orders', of: 'orderpass', open: String(orderId) });

/** Кнопка «Паспорта заказа» (kit.button). */
export const orderPassportsButton = (orderId, size = 'S') => kit.button({ label: 'Паспорта заказа', size, title: 'Выпустить и распечатать паспорта по всем позициям заказа', onClick: () => openOrderPassports(orderId) });

/**
 * C104: окно «Печать» паспортов заказа — те же настройки, что у одного паспорта (формат, печать/подпись, ч/б)
 * и выбор позиций галочками. Один PDF по отмеченным: GET …/pdf?ids=…
 */
export async function printOrderDialog(row, { only = null } = {}) { // only — Set incomeId: отмечены только эти (C124: подвал заказа)
  const { passportVariant, printOptions } = await import('./passports/dialogs.js');
  const issued = (row.lines || []).filter((l) => l.state === 'issued' && l.passport?.id);
  if (!issued.length) return;
  const boxes = issued.map((l) => {
    const text = [`${l.lineNo ?? '—'}`, displayName(l.title) || 'Позиция', l.passport.number ? '№ ' + l.passport.number : ''].filter(Boolean).join(' · ');
    const el = kit.guide.toggle({ label: text, checked: !only || only.has(String(l.incomeId)), onChange: () => sync() });
    const cb = el.querySelector('input'); cb.dataset.id = String(l.passport.id);
    return { cb, el };
  });
  const sync = () => {
    const none = !boxes.some((b) => b.cb.checked);
    const ok = body.closest('form')?.querySelector('[type=submit]');
    if (ok) ok.disabled = none;
  };
  const setAll = (on) => { boxes.forEach((b) => { b.cb.checked = on; }); sync(); };
  const firm = row.firm || null;
  const po = printOptions({
    org: firm ? { hasSeal: !!firm.hasSeal, hasSignature: !!firm.hasSignature } : null, // C104: сервер отдаёт, что у фирмы загружено
    formats: ORDER_FORMATS, mode: 'print',
    extraTop: h('div', null,
      h('div', { class: 'section-title' }, 'Какие паспорта печатать'),
      kit.scroll(kit.stack(...boxes.map((b) => b.el))), // 15+ позиций — прокрутка, окно не растягивается
      kit.actions(
        kit.button({ label: 'Отметить все', size: 'S', kind: 'ghost', onClick: () => setAll(true) }),
        kit.button({ label: 'Снять все', size: 'S', kind: 'ghost', onClick: () => setAll(false) }))),
  });
  const body = po.el;
  await kit.modal({
    title: `Печать паспортов заказа · № ${row.orderNo || 'без номера'}`, okText: 'Скачать PDF', wide: true, body,
    onOk: async (form) => {
      const ids = boxes.filter((b) => b.cb.checked).map((b) => b.cb.dataset.id);
      if (!ids.length) throw new Error('Отметьте хотя бы один паспорт');
      const ok = form.querySelector('[type=submit]');
      ok.classList.add('is-busy');
      try {
        const v = po.value();
        const all = ids.length === issued.length;
        const query = { ...printQuery({ variant: row._variant || passportVariant.value, ...v, ids: all ? null : ids }), readOnly: 1 };
        let name;
        try { name = await apiFile(`/passports/order/${row.orderId}/pdf`, { query, timeout: 600000, onFailed: (list) => kit.toast(`Не вошли в PDF: ${list.length}`, { error: true, sub: failedText(list), ms: 15000 }), fallback: `Паспорта_заказ_${row.orderNo || ''}.pdf` }); }
        catch (e) { if (e?.data?.failed) throw new Error(`Ни один паспорт не собрался.
${failedText(e.data.failed)}`); throw e; }
        kit.toast(`Скачан: ${name}`);
        return true;
      } finally { ok.classList.remove('is-busy'); }
    },
  });
}

/** Р5 (C112): несобранные паспорта — по строке на каждый: «№ — название: причина». */
export const failedText = (list) => (list || []).map((f) => `${f.passportNumber ? '№ ' + f.passportNumber + ' — ' : ''}${f.name || 'паспорт'}: ${f.reason || 'не собрался'}`).join('\n');

const fetchPlan = async (id, variant = 'short') => {
  const pick = pickOf(id);
  const row = await api(`/passports/order/${id}/plan`, { query: { presentationVersion: 1, variant, ...(pick ? { supplierOrgId: pick.id } : {}) } });
  return { ...row, _variant: variant };
};

/**
 * C111: кнопка «Печать паспортов…» для мест, где плана заказа нет (карточка заказа, «По заказам»).
 * issued — сколько выпущено (известно месту); 0 → кнопка неактивна с подсказкой. План грузится по клику.
 */
export function printOrderButton(orderId, { issued = 0, size = 'S', kind = 'secondary', only = null } = {}) { // only() → Set incomeId | null
  return kit.button({
    label: 'Печать паспортов…', size, kind, disabled: !issued,
    title: issued ? 'Выбрать паспорта и вид — получится один PDF' : 'Сначала выпустите хотя бы один паспорт',
    onClick: async (e) => {
      e.stopPropagation();
      const b = e.currentTarget; b.classList.add('is-busy'); b.disabled = true;
      try { await printOrderDialog({ ...(await fetchPlan(orderId)), orderId }, { only: only?.() || null }); }
      catch (er) { kit.toastError(er, 'собрать PDF паспортов'); }
      finally { b.classList.remove('is-busy'); b.disabled = false; }
    },
  });
}

function summaryRow(row) {
  return kit.row({
    title: summaryText(row),
    tone: row.blocked ? 'warn' : 'ok', wrap: true,
  });
}

/** Фото изделия в строке плана (пользователь 14.11): миниатюра, клик — крупно. Нет фото — ничего. */
const pic = (l) => kit.posPic(l.photo || null, 'sm'); // и без изделия — рамка «нет фото»: строки ровные

function lineView(l, reload, issueOne, order) {
  const choose = canEdit() && l.productId ? kit.button({ label: 'Выбрать вложенный паспорт', size: 'S', kind: 'ghost',
    onClick: (e) => openPassportSourcePicker(order.orderId, l.incomeId, { parent: e.currentTarget.closest('.drawer'), onSaved: () => reload() }) }) : null;
  if (attachmentSource(l)) return kit.section({ title: `${l.lineNo ?? '—'} · ${displayName(l.title) || 'Позиция'}`, lead: pic(l), open: true, plain: true,
    body: [selectedPassportActions(order.orderId, l.incomeId, l, { reload, editable: canEdit() }), siteHistory(l.sitePassports)] });
  const [label, tone] = STATE[l.state] || ['—', 'dim'];
  const name = `${l.lineNo ?? '—'} · ${displayName(l.title) || 'Позиция'}`;
  const format = l.passport ? variantName(l.passport.variant) || 'Прежний формат' : null;
  const meta = [l.article, l.productName && l.productName !== l.title ? displayName(l.productName) : '', l.productId ? (l.categoryName || 'категория не выбрана') : '', l.qty != null ? `${l.qty} шт` : '', format].filter(Boolean).join(' · ');
  const after = () => reload().catch((e) => kit.toastError(e, 'обновить план паспортов'));
  const templateButton = () => kit.button({
    label: 'Править шаблон', size: 'S', kind: 'ghost',
    onClick: async (e) => {
      const b = e.currentTarget;
      const end = busyBtn(b, null);
      try {
        const { openBookForProduct } = await import('./passports/open-book.js');
        await openBookForProduct(l.productId, {
          variant: l.passport?.variant || order._variant,
          position: { salesOrderId: order.orderId, incomeId: l.incomeId, lineNo: l.lineNo, orderNo: order.orderNo,
            supplierOrgId: !order.firm ? pickOf(order.orderId)?.id : undefined },
          onClose: after, isCurrent: () => b.isConnected,
        });
      } finally { end(); }
    },
  });
  const openDraft = l.passport?.status === 'draft' && l.passport.id
    ? kit.button({ label: 'Открыть черновик', size: 'S', onClick: async () => {
      const { openBookEditor } = await import('./passports/book-editor.js');
      await openBookEditor(l.passport.id, { onClose: after });
    } }) : null;
  if (l.state === 'blocked' && l.productId && !firmOnly(l)) {
    // C086: название — обычным текстом; что не так и что делать — второй строкой; состояние — меткой справа, а не цветом всей строки
    const n = missingCount(l.missing);
    return kit.section({
      lead: pic(l), title: name, plain: true, tone: 'neutral',
      sub: [meta, `Заполнить: ${shortMissing(l.missing)}`].filter(Boolean).join(' · '),
      side: kit.badge(n ? `не хватает ${n}` : label, tone),
      body: [kit.actions(openDraft, canEdit() ? templateButton() : null, choose)],
    });
  }
  const below = l.state === 'issued' ? null
    : l.state === 'ready' ? 'можно выпускать' : shortMissing(l.missing);
  const side = [
    l.state === 'issued' && l.passport?.number
      ? h('span', { class: 'nowrap' }, `Паспорт № ${l.passport.number}`) : null,
    kit.badge(label, tone),
  ].filter(Boolean);
  let action = null;
  if (l.state === 'ready' && l.productId && canEdit()) {
    // пользователь 14.11: «готов к выпуску, а печати нет» — выпуск прямо в строке; после него появится «Печать…»
    action = [
      issueOne ? kit.button({ label: 'Выпустить', size: 'S', title: 'Выпустить паспорт этой позиции — затем его можно распечатать',
        onClick: (e) => issueOne(l, e.currentTarget) }) : null,
      openDraft,
      templateButton(),
    ].filter(Boolean);
  } else if (l.state === 'issued' && l.passport?.id) {
    const pid = l.passport.id;
    action = [
      kit.button({ label: 'Печать…', size: 'S', kind: 'ghost', title: 'Скачать PDF этого паспорта',
        onClick: async (e) => {
          const b = e.currentTarget; b.classList.add('is-busy');
          try {
            const { printDialog } = await import('./passports/dialogs.js');
            await printDialog(await api(`/passports/${pid}`, { query: { readOnly: 1 } }));
          }
          catch (er) { kit.toastError(er, 'открыть печать паспорта'); }
          finally { b.classList.remove('is-busy'); }
        } }),
      kit.button({ label: canEdit() && ['short', 'full'].includes(l.passport.variant) ? 'Изменить паспорт' : 'Открыть паспорт', size: 'S', kind: 'ghost',
        title: canEdit() && ['short', 'full'].includes(l.passport.variant) ? 'Правки сохранятся новой редакцией с прежним номером' : 'Открыть паспорт для просмотра и печати',
        onClick: async (e) => {
          const b = e.currentTarget; b.classList.add('is-busy');
          try {
            const { openBookEditor } = await import('./passports/book-editor.js');
            await openBookEditor(pid, { onClose: after });
          }
          catch (er) { kit.toastError(er, 'открыть паспорт'); }
          finally { b.classList.remove('is-busy'); }
        } }),
    ];
  } else if (openDraft) action = [openDraft];
  // пользователь 14.11: выпущенная/готовая позиция — в такой же рамке-карточке, как строка «не хватает» выше
  if (!action && !choose) return kit.row({ lead: pic(l), title: name, meta: [meta, below].filter(Boolean).join(' · ') || null, side, wrap: true });
  return kit.section({
    lead: pic(l), title: name, plain: true, tone: 'neutral', open: true,
    sub: [meta, below].filter(Boolean).join(' · ') || null,
    side,
    body: [kit.actions(...(action || []), choose)],
  });
}

function siteHistory(list) {
  const issued = (list || []).filter((p) => p.status === 'issued');
  return issued.length ? kit.section({ title: 'Ранее выпущено на сайте', body: issued.map((p) => kit.button({
    label: `Паспорт № ${p.number || '—'}`, size: 'S', kind: 'ghost', onClick: async () => {
      try { const { openBookEditor } = await import('./passports/book-editor.js'); await openBookEditor(p.id); }
      catch (err) { kit.toastError(err); }
    },
  })) }) : null;
}

function firmBlock(row, reload) {
  const choices = row.firmChoices || [];
  if (row.firm && choices.length < 2) return kit.hint(`Фирма: ${row.firm.name}`);
  if (!row.firm && choices.length === 1) return kit.hint(`Фирма: ${choices[0].name}`);
  if (!choices.length) {
    const needs = (row.lines || []).some((l) => (l.missing || []).some((m) => /фирм/i.test(String(m))));
    return needs ? kit.hint('Наших фирм нет. Добавьте компанию в «Контрагенты».', 'warn') : null;
  }
  const cur = pickOf(row.orderId);
  const save = async (id) => {
    const name = choices.find((c) => c.id === id)?.name || 'фирма';
    try {
      await api(`/salesorders/${row.orderId}`, { method: 'PATCH', body: { companyId: id } });
      pickedFirm.delete(String(row.orderId));
      kit.toast(`Фирма «${name}» записана в заказ`);
      window.dispatchEvent(new Event('data-changed'));
    } catch (e) {
      if (e?.status === 403 || e?.status === 409) {
        pickedFirm.set(String(row.orderId), { id, name });
        kit.toast(e.status === 403 ? 'Для выпуска фирма выбрана. В заказ её запишет менеджер.' : 'В заказ не записана. Для выпуска фирма выбрана.');
      } else {
        kit.toastError(e, 'записать фирму в заказ');
        return false;
      }
    }
    return true;
  };
  const sel = kit.select({
    label: 'Фирма заказа',
    options: [...(row.firm ? [] : [['', '— выберите —']]), ...choices.map((c) => [c.id, c.name])],
    value: cur?.id || row.firm?.id || '',
    disabled: !canEdit(),
    onChange: async (id) => {
      if (!id) return;
      sel.disabled = true;
      const ok = await save(id);
      if (!ok) { sel.value = cur?.id || row.firm?.id || ''; sel.disabled = !canEdit(); return; }
      try { await reload(); } catch (e) { kit.toastError(e, 'обновить план паспортов'); }
    },
  });
  return h('div', null,
    kit.hint(row.firm ? `Фирма заказа: ${row.firm.name}. Можно выбрать другую — паспорта ещё не выпущенных позиций выйдут от неё.` : cur ? `Фирма для выпуска: ${cur.name}. В заказ пока не записана.` : 'Какая фирма оформляет заказ? Выберите — запишется в заказ сразу.'),
    sel);
}

function body(row, ctx) {
  const editable = canEdit();
  const readyN = row.ready || 0;
  const issuedN = row.issued || 0;
  const variant = row._variant || 'short';
  const reload = async (extra, nextVariant = variant) => {
    const next = await fetchPlan(row.orderId, nextVariant);
    if (next.firm) pickedFirm.delete(String(row.orderId));
    ctx.setRow({ ...next, ...(extra || {}) });
  };
  const pick = !row.firm ? pickOf(row.orderId) : null;
  /** Выпуск одной позиции (тот же POST, что «Выпустить готовые», с lines: [позиция]). */
  const issueOne = async (l, b) => {
    b.classList.add('is-busy'); b.disabled = true;
    try {
      const r = await api(`/passports/order/${row.orderId}/issue`, { method: 'POST', body: { presentationVersion: 1, lines: [l.incomeId], variant, ...(pick ? { supplierOrgId: pick.id } : {}) } });
      const skip = (r.skipped || [])[0];
      kit.toast(skip ? `Не выпущен: ${skip.reason}` : 'Паспорт выпущен — теперь его можно распечатать');
      window.dispatchEvent(new Event('data-changed'));
      await reload({ _skipped: r.skipped || [] });
    } catch (er) { b.classList.remove('is-busy'); b.disabled = false; kit.toastError(er, 'выпустить паспорт'); }
  };

  const seg = kit.segmented({
    label: 'Вариант паспорта', fit: true,
    items: bookVariants,
    value: variant,
    onChange: async (k) => {
      seg.set(variant);
      if (k === variant) return;
      seg.buttons.forEach((btn) => { btn.disabled = true; });
      try { await reload(undefined, k); } catch (e) { kit.toastError(e, 'обновить план паспортов'); }
      finally { seg.buttons.forEach((btn) => { btn.disabled = false; }); }
    },
  });

  const issueBtn = kit.button({
    label: `Выпустить готовые (${readyN})`, kind: readyN ? 'primary' : 'secondary', disabled: !editable || !readyN,
    title: readyN ? 'Выпустить паспорта по позициям, где всё заполнено' : 'Готовых к выпуску позиций нет',
    onClick: async (e) => {
      const b = e.currentTarget; b.classList.add('is-busy'); b.disabled = true;
      try {
        const r = await api(`/passports/order/${row.orderId}/issue`, { method: 'POST', body: { presentationVersion: 1, variant, ...(pick ? { supplierOrgId: pick.id } : {}) } });
        const n = (r.issued || []).length, m = (r.skipped || []).length;
        kit.toast(`Выпущено ${n}, пропущено ${m}`);
        window.dispatchEvent(new Event('data-changed'));
        await reload({ _skipped: r.skipped || [] });
      } catch (er) { b.classList.remove('is-busy'); b.disabled = false; kit.toastError(er, 'выпустить паспорта заказа'); }
    },
  });

  const printPrimary = issuedN > 0 && !readyN;
  const printBtn = kit.button({
    label: 'Печать паспортов…', kind: printPrimary ? 'primary' : 'secondary', disabled: !issuedN,
    title: issuedN ? 'Выбрать паспорта и вид — получится один PDF' : 'Сначала выпустите хотя бы один паспорт',
    onClick: () => printOrderDialog(row).catch((er) => kit.toastError(er, 'собрать PDF паспортов')),
  });

  const lines = (row.lines || []).length
    ? kit.stack(...(row.lines || []).map((l) => lineView(l, reload, editable ? issueOne : null, row)))
    : kit.hint('В заказе нет позиций. Добавьте позиции — здесь появится план паспортов.');

  const skipped = row._skipped?.length ? kit.section({
    title: 'Пропущено при выпуске', count: row._skipped.length, open: true,
    body: row._skipped.map((s) => kit.row({ title: s.title || 'Позиция', meta: s.reason, tone: 'warn' })),
  }) : null;

  const filesBox = h('div');
  if (issuedN) {
    api('/passports', { query: { salesOrderId: row.orderId, status: 'issued', limit: 200 } }).then((d) => {
      const files = (d.items || []).filter((x) => x.printSource === 'file' || x.printFile?.hasFile);
      if (!files.length) return;
      filesBox.replaceChildren(h('p', { class: 'muted small' }, 'В общий PDF не входят, скачиваются отдельным файлом: ',
        ...files.flatMap((x, i) => [i ? ', ' : null, kit.link({ label: '№ ' + x.passportNumber, title: x.name || 'Скачать файл', onClick: async () => {
          try { const { download } = await import('./passports/dialogs.js'); await download(x, {}, 'файл'); }
          catch (e) { kit.toastError(e, 'скачать файл'); }
        } })])));
    }).catch(() => {});
  }

  const blockedN = (row.lines || []).filter((l) => l.state === 'blocked').length;
  const noReady = readyN ? null : kit.hint(blockedN ? `Готовых к выпуску нет: заполните данные или выберите доступный вложенный паспорт (${blockedN}).` : issuedN || row.attached ? 'Документы готовы.' : 'Готовых к выпуску позиций нет.');
  const buttons = printPrimary ? [printBtn, issueBtn] : [issueBtn, printBtn];
  // C111: stack — зазор между шапкой, рядом кнопок и списком (на телефоне кнопки не липнут к списку).
  // Ш1: выпуск и печать — сразу под сводкой, видны без прокрутки при 12+ позициях.
  return kit.stack(
    kit.headbar(h('div', null, summaryRow(row), firmBlock(row, reload), kit.hint('Вариант для новых паспортов.')), seg.el),
    kit.actions(...buttons),
    row.attached || (row.lines || []).some(attachmentSource) ? kit.hint('Вложенные паспорта не выпускаются на сайте и не входят в общий PDF. Скачивайте их отдельно у позиции.') : null,
    noReady,
    skipped, lines,
    // отменённые позиции сюда не идут (13.11); одна серая строка объясняет, почему позиций меньше, чем в заказе (14.11)
    row.cancelled ? kit.hint(`Отменено в заказе: ${row.cancelled} ${plural(row.cancelled, 'позиция', 'позиции', 'позиций')} — паспорта на них не нужны.`) : null,
    // «Паспорт по позиции» убрана (2026-11-13): открывала общую воронку выбора изделия — повтор строки позиции «›»
    filesBox);
}

export const orderpass = {
  id: 'orderpass',
  title: 'Паспорта заказа',
  kind: 'Паспорта',
  noun: 'паспорта заказа',
  canEdit: () => true,
  get: async (id) => ({ id, ...(await fetchPlan(id)) }),
  card: {
    heading: (r) => `Паспорта заказа · № ${r.orderNo || 'без номера'}${r.customerName ? ' · ' + r.customerName : ''}`,
    noHistory: true,
    view: () => [],
    extra: body,
  },
};
