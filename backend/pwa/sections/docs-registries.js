import { api, apiBlob, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, qty } from '../core/format.js';
import { canFollow } from '../core/route-access.js';
import { actions, autoMore, badge, button, empty, guide, hint, modal, openPdfPreview, searchBox, stack, tabs, textInput, toast, toastError, toolbar, pad } from '../ui/kit/index.js';

import { positionsTable } from '../ui/kit/screens/blocks.js';

const STATES = {
  missing: ['Не выпущен', 'dim'], draft: ['Черновик', 'dim'], check: ['Нужно уточнить', 'warn'],
  issued: ['Выпущен', 'ok'], attached: ['Вложенный PDF', 'ok'],
};
const MODES = [['work', 'В работе'], ['handover', 'К передаче'], ['history', 'История передачи'], ['all', 'Все реестры']];
const registryPath = (id) => '/passports/registry/' + encodeURIComponent(id);

function printRegistry(id) {
  return openPdfPreview({
    title: 'Реестр паспортов',
    load: () => apiBlob(registryPath(id) + '/pdf', { fallback: 'Реестр паспортов.pdf' }),
  });
}

async function confirmHandover(registry) {
  const recipient = textInput({ label: 'Получатель', required: true, max: 160, placeholder: 'Имя или организация' });
  const handedOn = textInput({ label: 'Дата передачи', type: 'date', required: true, value: new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10) });
  const clientUid = crypto.randomUUID();
  return modal({
    title: 'Передано заказчику',
    okText: 'Подтвердить передачу',
    body: stack(
      hint('Будет сохранён комплект из ' + registry.rows.length + ' позиций и их текущих редакций.'),
      recipient.el,
      handedOn.el,
    ),
    onOk: () => api(registryPath(registry.orderId) + '/handover', {
      method: 'POST',
      body: { clientUid, fingerprint: registry.fingerprint, recipient: recipient.input.value.trim(), handedOn: handedOn.input.value },
    }),
  });
}

function registryRows(registry) {
  return positionsTable({
    label: 'Позиции реестра паспортов',
    columns: [{ label: '№', num: true }, { label: 'Изделие', wrap: true }, { label: 'Количество', num: true },
      { label: 'Паспорт / файл', wrap: true }, { label: 'Состояние', wrap: true }],
    groups: [{ rows: registry.rows.map((line, i) => {
      const [label, tone] = STATES[line.state] || STATES.check;
      const doc = line.document;
      const name = [doc?.number ? '№ ' + doc.number : '', doc?.revision ? 'ред. ' + doc.revision : '', doc?.fileName].filter(Boolean).join(' · ');
      return { cells: [
        line.lineNo ?? i + 1, line.title, line.qty == null ? '—' : qty(line.qty), name || '—',
        h('div', null, badge(registry.current ? 'Передан' : label, registry.current ? 'ok' : tone),
          line.note ? h('div', { class: 'muted small' }, line.note) : null),
      ] };
    }) }],
  });
}

function registryPanel(item, refresh) {
  const panel = h('div', null, hint('Загружаем реестр…'));
  const render = (registry) => {
    const current = registry.current;
    const order = '#salesorders?open=' + encodeURIComponent(registry.productionNo || registry.orderId);
    const mayWrite = session.canEdit;
    const produce = () => import('./order-passport-plan.js').then(({ openOrderPassports }) => openOrderPassports(item.id));
    const controls = actions(
      button({ label: 'Печать реестра…', size: 'S', onClick: () => printRegistry(item.id) }),
      registry.ready < registry.rows.length && mayWrite
        ? button({ label: 'Паспорта заказа', size: 'S', onClick: produce }) : null,
      registry.canHandover && mayWrite ? button({
        label: 'Передано заказчику', kind: 'primary', size: 'S',
        onClick: async () => {
          const updated = await confirmHandover(registry);
          if (!updated) return;
          render(updated);
          toast('Передача зафиксирована');
          refresh();
        },
      }) : null,
      canFollow(session, order) ? h('a', { class: 'btn btn-ghost btn-sm', href: order }, 'Открыть заказ') : null,
    );
    panel.replaceChildren(stack(
      pad(controls),
      current ? hint('Передано ' + date(current.handedOn) + ' · ' + current.recipient) : null,
      registryRows(registry),
      registry.unlinked.length ? hint('Старые паспорта без однозначной позиции: ' + registry.unlinked.map((p) => p.number ? '№ ' + p.number : p.name || 'без номера').join(', ')) : null,
      registry.history.length ? h('section', null, h('h3', null, 'История передачи'), ...registry.history.map((record) =>
        guide.cat({ title: date(record.handedOn) + ' · ' + record.recipient, count: record.rows.length, body: [
          record.actorName ? hint('Отметил: ' + record.actorName) : null,
          registryRows({ rows: record.rows, current: record })] }))) : null,
    ));
  };
  api(registryPath(item.id)).then(render).catch((e) => {
    panel.replaceChildren(empty({ kind: 'fail', title: 'Реестр не открылся' }));
    toastError(e, 'открыть реестр');
  });
  return panel;
}

export function mountRegistryTab(params = {}) {
  let mode = MODES.some(([key]) => key === params.registryState) ? params.registryState : 'work';
  let term = params.search || '';
  const rows = h('div');
  const chosen = h('div');
  const search = searchBox({ value: term, label: 'Поиск реестра', className: 'search', placeholder: 'Номер договора, заказа или заказчик', onSearch: (value) => {
    term = value;
    pager.reload();
  } });
  const switcher = tabs({ items: MODES.map(([key, label]) => ({ key, label })), value: mode, label: 'Состояние комплекта', onChange: (value) => {
    mode = value;
    chosen.replaceChildren();
    pager.reload();
  } });
  const pager = autoMore({
    root: rows, limit: 20, text: { fail: 'Реестры не загрузились' },
    load: (page, { limit }) => api('/passports/registry', { query: { page, limit, search: term, state: mode } }),
    render: (items) => rows.replaceChildren(positionsTable({
      label: 'Реестры паспортов по заказам',
      columns: [{ label: 'Заказ / договор', wrap: true }, { label: 'Заказчик', wrap: true },
        { label: 'Готово', num: true }, { label: 'Передача', wrap: true }],
      groups: [{ rows: items.map((item) => ({
        key: item.id,
        cells: [[item.productionNo, item.orderNo].filter(Boolean).join(' · ') || 'Без номера', item.customer || '—',
          item.ready + ' из ' + item.positions, item.handedOn ? badge(date(item.handedOn), 'ok') : 'Ожидает'],
        expand: () => registryPanel(item, () => pager.reload({ keep: true })),
      })) }],
      empty: { title: mode === 'work' ? 'Нет незавершённых комплектов' : 'Реестров в этой выборке нет' },
    })),
  });

  function openRequested(id) {
    chosen.replaceChildren();
    if (id) chosen.append(registryPanel({ id }, () => pager.reload({ keep: true })));
  }
  openRequested(params.registryOrder);
  pager.reload();
  return {
    el: stack(toolbar(search.el), switcher.el, chosen, rows, pager.el),
    focusSearch: () => search.focus(),
    reload: () => pager.reload({ keep: true }),
    update: (next) => openRequested(next.registryOrder),
    destroy: () => pager.destroy(),
  };
}
