import { api, apiFile } from '../core/api.js';
import { h } from '../core/dom.js';
import { go } from '../core/router.js';
import * as kit from '../ui/kit/index.js';
import { canEdit } from './passports/common.js';
import { download, passportVariant } from './passports/dialogs.js';

/*
 * ПНЗ.2 / C075: правая панель «Паспорта заказа» (of=orderpass&open=<orderId>).
 * Сервер: GET /passports/order/:id/plan?variant&supplierOrgId, POST .../issue {lines?, variant, supplierOrgId?}, GET .../pdf.
 * Фирма — один раз на заказ. Пробелы позиции заполняются здесь же (passportFill, mode issue).
 */
const STATE = { issued: ['Выпущен', 'ok'], ready: ['Готов к выпуску', 'info'], blocked: ['Не хватает данных', 'warn'] };
/** Выбранная фирма, если в заказ записать не удалось (нет права): живёт, пока панель открыта. */
const pickedFirm = new Map();

const missingText = (m) => {
  const a = m || [];
  return a.length <= 2 ? a.join('; ') : `${a.slice(0, 2).join('; ')} и ещё ${a.length - 2}`;
};
const firmOnly = (l) => (l.missing || []).length > 0 && (l.missing || []).every((m) => /фирм/i.test(String(m)));
const pickOf = (orderId) => pickedFirm.get(String(orderId)) || null;

/** Открыть панель: из «По заказам» и из карточки заказа. */
export const openOrderPassports = (orderId) => go('docs', { tab: 'orders', of: 'orderpass', open: String(orderId) });

/** Кнопка «Паспорта заказа» (kit.button). */
export const orderPassportsButton = (orderId, size = 'S') => kit.button({ label: 'Паспорта заказа', size, title: 'Выпустить и распечатать паспорта по всем позициям заказа', onClick: () => openOrderPassports(orderId) });

const fetchPlan = (id) => {
  const pick = pickOf(id);
  return api(`/passports/order/${id}/plan`, { query: { variant: passportVariant.value, ...(pick ? { supplierOrgId: pick.id } : {}) } });
};

function lackText(row) {
  const seen = new Set();
  const labels = [];
  for (const l of row.lines || []) {
    if (l.state !== 'blocked') continue;
    for (const m of l.missing || []) {
      if (seen.has(m)) continue;
      seen.add(m);
      labels.push(m);
    }
  }
  if (!labels.length) return '';
  const shown = labels.length <= 4 ? labels.join(', ') : `${labels.slice(0, 3).join(', ')} и ещё ${labels.length - 3}`;
  return `не хватает: ${shown}`;
}

function summaryRow(row) {
  const done = (row.ready || 0) + (row.issued || 0);
  const lack = lackText(row);
  return kit.row({
    title: `Готово ${done} из ${row.total || 0}${lack ? ' · ' + lack : ''}`,
    tone: row.blocked ? 'warn' : 'ok',
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
      prod, mode: 'issue',
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
  const name = `${l.lineNo ?? '—'} · ${l.title || 'Позиция'}`;
  const meta = [l.article, l.productName, l.qty != null ? `${l.qty} шт` : ''].filter(Boolean).join(' · ');
  if (l.state === 'blocked' && l.productId && !firmOnly(l)) {
    const host = h('div');
    const sec = kit.section({
      title: `${name} — ${missingText(l.missing)}`,
      tone: 'warn',
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
    : l.state === 'ready' ? 'можно выпускать' : missingText(l.missing);
  return kit.row({ title: name, meta: meta || null, side: [kit.badge(label, tone)], below });
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
    label: 'Вариант паспорта',
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
    label: 'Печать всех', kind: printPrimary ? 'primary' : 'secondary', disabled: !issuedN,
    title: issuedN ? 'Один PDF со всеми выпущенными паспортами заказа' : 'Сначала выпустите хотя бы один паспорт',
    onClick: async (e) => {
      const b = e.currentTarget; b.classList.add('is-busy'); b.disabled = true;
      try {
        const name = await apiFile(`/passports/order/${row.orderId}/pdf`, { query: { variant: passportVariant.value }, timeout: 600000, fallback: `Паспорта_заказ_${row.orderNo || ''}.pdf` });
        kit.toast(`Скачан: ${name}`);
      } catch (er) { kit.toastError(er, 'собрать PDF паспортов'); } finally { b.classList.remove('is-busy'); b.disabled = !issuedN; }
    },
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
  return h('div', null,
    summaryRow(row),
    firmBlock(row, reload),
    seg.el,
    lines, skipped,
    kit.actions(...buttons, editable ? kit.button({ label: 'Паспорт по позиции', kind: 'ghost', title: 'Выбрать позицию заказа и выпустить один паспорт', onClick: async () => { const { openPassportFunnel } = await import('./passports/funnel/open.js'); openPassportFunnel({ salesOrderId: row.orderId, orderNo: row.orderNo, customerName: row.customerName }); } }) : null,
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
