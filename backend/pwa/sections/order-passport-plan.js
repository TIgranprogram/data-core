import { api, apiFile } from '../core/api.js';
import { h } from '../core/dom.js';
import { go } from '../core/router.js';
import * as kit from '../ui/kit/index.js';
import { canWorkPassport as canEdit } from './passports/common.js';
import { download, passportVariant, printDialog, printOptions } from './passports/dialogs.js';
import { ORDER_FORMATS, printQuery } from './passports/print-options.js';
import { displayName } from './passports/fill/model.js';
import { shortMissing, summaryText } from './order-passport-text.js';

/*
 * ПНЗ.2 / C075: правая панель «Паспорта заказа» (of=orderpass&open=<orderId>).
 * Сервер: GET /passports/order/:id/plan?variant&supplierOrgId, POST .../issue {lines?, variant, supplierOrgId?}, GET .../pdf.
 * Фирма — один раз на заказ. Пробелы позиции заполняются здесь же (passportFill, mode issue).
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
export async function printOrderDialog(row) {
  const issued = (row.lines || []).filter((l) => l.state === 'issued' && l.passport?.id);
  if (!issued.length) return;
  const boxes = issued.map((l) => {
    const text = [`${l.lineNo ?? '—'}`, displayName(l.title) || 'Позиция', l.passport.number ? '№ ' + l.passport.number : ''].filter(Boolean).join(' · ');
    const el = kit.guide.toggle({ label: text, checked: true, onChange: () => sync() });
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
        const query = printQuery({ variant: passportVariant.value, ...v, ids: all ? null : ids });
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

const fetchPlan = (id) => {
  const pick = pickOf(id);
  return api(`/passports/order/${id}/plan`, { query: { variant: passportVariant.value, ...(pick ? { supplierOrgId: pick.id } : {}) } });
};

/**
 * C111: кнопка «Печать паспортов…» для мест, где плана заказа нет (карточка заказа, «По заказам»).
 * issued — сколько выпущено (известно месту); 0 → кнопка неактивна с подсказкой. План грузится по клику.
 */
export function printOrderButton(orderId, { issued = 0, size = 'S', kind = 'secondary' } = {}) {
  return kit.button({
    label: 'Печать паспортов…', size, kind, disabled: !issued,
    title: issued ? 'Выбрать паспорта и вид — получится один PDF' : 'Сначала выпустите хотя бы один паспорт',
    onClick: async (e) => {
      e.stopPropagation();
      const b = e.currentTarget; b.classList.add('is-busy'); b.disabled = true;
      try { await printOrderDialog({ ...(await fetchPlan(orderId)), orderId }); }
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

async function mountFill(line, host, reload) {
  host.replaceChildren(kit.hint('Загрузка…'));
  try {
    const prod = await api(`/showcase/${line.productId}`);
    const { passportFill } = await import('./passports/fill/index.js');
    let first = true;
    let dirty = false;
    let kicked = false;
    const fill = await passportFill({
      prod, mode: 'issue', showVariant: false, // вариант — один на заказ, в шапке панели
      onStatus: ({ required }) => {
        if (first) { first = false; dirty = false; return; }
        if (!dirty || (required && required.length) || kicked) return;
        kicked = true;
        reload().catch((e) => kit.toastError(e, 'обновить план паспортов'));
      },
    });
    fill.el.addEventListener('change', () => { dirty = true; }, true);
    fill.el.addEventListener('click', (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('button, a, select, input, textarea')) dirty = true;
    }, true);
    host.replaceChildren(fill.el);
  } catch (e) {
    delete host.dataset.loaded;
    host.replaceChildren(kit.hint('Не удалось открыть поля. Раскройте позицию ещё раз.', 'warn'));
    kit.toastError(e, 'открыть заполнение паспорта');
  }
}

function lineView(l, reload) {
  const [label, tone] = STATE[l.state] || ['—', 'dim'];
  const name = `${l.lineNo ?? '—'} · ${displayName(l.title) || 'Позиция'}`;
  const meta = [l.article, l.productName && l.productName !== l.title ? displayName(l.productName) : '', l.productId ? (l.categoryName || 'категория не выбрана') : '', l.qty != null ? `${l.qty} шт` : ''].filter(Boolean).join(' · ');
  if (l.state === 'blocked' && l.productId && !firmOnly(l)) {
    const host = h('div');
    // C086: название — обычным текстом; что не так и что делать — второй строкой; состояние — меткой справа, а не цветом всей строки
    const n = (l.missing || []).length;
    const sec = kit.section({
      title: name, plain: true, tone: 'neutral',
      sub: [meta, `Заполнить: ${shortMissing(l.missing)}`].filter(Boolean).join(' · '),
      side: kit.badge(n ? `не хватает ${n}` : label, tone),
      body: [host],
    });
    sec.addEventListener('toggle', () => {
      if (!sec.open || host.dataset.loaded) return;
      host.dataset.loaded = '1';
      mountFill(l, host, reload);
    });
    return sec;
  }
  const below = l.state === 'issued'
    ? (l.passport?.number ? '№ ' + l.passport.number : 'выпущен')
    : l.state === 'ready' ? 'можно выпускать' : shortMissing(l.missing);
  let action = null;
  if (l.state === 'ready' && l.productId && canEdit()) {
    action = kit.button({ label: 'Редактировать', size: 'S', kind: 'ghost',
      title: 'Открыть шаблон паспорта изделия для правки перед выпуском',
      onClick: () => go('docs', { tab: 'templates', of: 'doctpl', open: l.productId }, { kind: 'card' }) });
  } else if (l.state === 'issued' && l.passport?.id) {
    const pid = l.passport.id;
    action = [
      kit.button({ label: 'Печать…', size: 'S', kind: 'ghost', title: 'Скачать PDF этого паспорта',
        onClick: async (e) => {
          const b = e.currentTarget; b.classList.add('is-busy');
          try { await printDialog(await api(`/passports/${pid}`)); }
          catch (er) { kit.toastError(er, 'открыть печать паспорта'); }
          finally { b.classList.remove('is-busy'); }
        } }),
      kit.button({ label: 'Открыть паспорт', size: 'S', kind: 'ghost',
        title: 'Открыть карточку: исправить и распечатать заново',
        onClick: () => go('docs', { tab: 'orders', of: 'passports', open: pid }, { kind: 'card' }) }),
    ];
  }
  return kit.row({ title: name, meta: [meta, below].filter(Boolean).join(' · ') || null,
    side: [kit.badge(label, tone)], action, wrap: true, cls: action ? 'k-row-stack-action' : undefined });
}

function firmBlock(row, reload) {
  if (row.firm) return kit.hint(`Фирма: ${row.firm.name}`);
  const choices = row.firmChoices || [];
  if (choices.length === 1) return kit.hint(`Фирма: ${choices[0].name}`);
  if (!choices.length) {
    const needs = (row.lines || []).some((l) => (l.missing || []).some((m) => /фирм/i.test(String(m))));
    return needs ? kit.hint('Наших фирм нет. Добавьте компанию в «Контрагенты».', 'warn') : null;
  }
  const cur = pickOf(row.orderId);
  const save = async (id) => {
    const name = choices.find((c) => c.id === id)?.name || 'фирма';
    if (!(await kit.confirmDlg(`Записать «${name}» в заказ?`, 'Паспорта этого заказа выйдут от этой фирмы.', { okText: 'Записать в заказ' }))) return false;
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
    label: 'Какая фирма оформляет заказ?',
    options: [['', '— выберите —'], ...choices.map((c) => [c.id, c.name])],
    value: cur?.id || '',
    disabled: !canEdit(),
    onChange: async (id) => {
      if (!id) return;
      sel.disabled = true;
      const ok = await save(id);
      if (!ok) { sel.value = cur?.id || ''; sel.disabled = !canEdit(); return; }
      try { await reload(); } catch (e) { kit.toastError(e, 'обновить план паспортов'); }
    },
  });
  return h('div', null,
    kit.hint(cur && !row.firm ? `Фирма для выпуска: ${cur.name}. В заказ пока не записана.` : 'Какая фирма оформляет заказ?'),
    sel);
}

function body(row, ctx) {
  const editable = canEdit();
  const readyN = row.ready || 0;
  const issuedN = row.issued || 0;
  const reload = async (extra) => {
    const next = await fetchPlan(row.orderId);
    if (next.firm) pickedFirm.delete(String(row.orderId));
    ctx.setRow({ ...next, ...(extra || {}) });
  };
  const pick = !row.firm ? pickOf(row.orderId) : null;

  const seg = kit.segmented({
    label: 'Вариант паспорта', fit: true,
    items: [{ key: 'short', label: 'Упрощённый' }, { key: 'full', label: 'Полный' }],
    value: passportVariant.value,
    onChange: async (k) => { passportVariant.value = k; try { await reload(); } catch (e) { kit.toastError(e, 'обновить план паспортов'); } },
  });

  const issueBtn = kit.button({
    label: `Выпустить готовые (${readyN})`, kind: readyN ? 'primary' : 'secondary', disabled: !editable || !readyN,
    title: readyN ? 'Выпустить паспорта по позициям, где всё заполнено' : 'Готовых к выпуску позиций нет',
    onClick: async (e) => {
      const b = e.currentTarget; b.classList.add('is-busy'); b.disabled = true;
      try {
        const r = await api(`/passports/order/${row.orderId}/issue`, { method: 'POST', body: { variant: passportVariant.value, ...(pick ? { supplierOrgId: pick.id } : {}) } });
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
    ? kit.stack(...(row.lines || []).map((l) => lineView(l, reload)))
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
        ...files.flatMap((x, i) => [i ? ', ' : null, kit.link({ label: '№ ' + x.passportNumber, title: x.name || 'Скачать файл', onClick: () => download(x, {}, 'файл').catch((e) => kit.toastError(e, 'скачать файл')) })])));
    }).catch(() => {});
  }

  const buttons = printPrimary ? [printBtn, issueBtn] : [issueBtn, printBtn];
  // C111: stack — зазор между шапкой, рядом кнопок и списком (на телефоне кнопки не липнут к списку).
  // Ш1: выпуск и печать — сразу под сводкой, видны без прокрутки при 12+ позициях.
  return kit.stack(
    kit.headbar(h('div', null, summaryRow(row), firmBlock(row, reload)), seg.el),
    kit.actions(...buttons),
    skipped, lines,
    // «Паспорт по позиции» убрана (2026-11-13): открывала общую воронку выбора изделия — повтор строки позиции «›»
    kit.actions(
      editable ? kit.button({ label: 'Добавить готовый паспорт', kind: 'ghost', title: 'Паспорт сделан отдельно: приложить файл PDF к этому заказу', onClick: async () => { const { openReadyPassport } = await import('./passports/funnel/open.js'); openReadyPassport({ salesOrderId: row.orderId, orderNo: row.orderNo, customerName: row.customerName }); } }) : null),
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
