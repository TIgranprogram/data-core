import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { dateTime } from '../core/format.js';
import { current, go } from '../core/router.js';
import { busyBlock, failBlock } from '../ui/kit/busy.js';
import { confirmDlg } from '../ui/kit/dialog.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { actions, section, stack, tabs as kitTabs, empty as kitEmpty, button, row, badge, enhanceSelect, select as kitSelect } from '../ui/kit/index.js';

/**
 * «Управление → Сотрудники» (ЗО-2): список сотрудников, вкладка «Зоны», плашка «Не назначено».
 * Правка — только в правой панели: карточка сотрудника (`of=staffcard`: вход, зоны, история) и карточка зоны (`of=zonecard`).
 * Сервер: /zones, /staff (+ loginsWithoutPerson), POST /staff/from-login, /staff/logins, /staff/:id, PUT /staff/:id/zones, PUT /staff/:id/login.
 */
const TABS = [['staff', 'Сотрудники'], ['zones', 'Зоны']];
const tabOf = (p) => (p?.tab === 'zones' ? 'zones' : 'staff');
const check = (label, checked, onchange, disabled) => {
  const input = h('input', { type: 'checkbox', checked: !!checked, disabled: !!disabled, onchange: (e) => onchange?.(e.target.checked) });
  return h('label', { class: 'check st-check' + (disabled ? ' off' : '') }, input, ' ', label);
};
const busy = async (e, fn) => { const b = e.currentTarget; b.classList.add('is-busy'); b.disabled = true; try { return await fn(); } finally { b.classList.remove('is-busy'); b.disabled = false; } };
const openPanel = (of, id) => { const c = current(); go('staff', { tab: c.params.tab, of, open: id, new: undefined }, { replace: !!c.params.open, kind: 'card' }); };

// ─── экран ─────────────────────────────────────────────────────────────────────────────────────────────
export function mountStaff(params) {
  let tab = tabOf(params);
  let zones = null;   // GET /zones
  let staff = null;   // GET /staff
  const note = h('div', { class: 'st-note' });
  const tabsKit = kitTabs({ items: TABS.map(([key, label]) => ({ key, label })), value: tab, label: 'Сотрудники', onChange: (k) => { if (tab !== k) go('staff', k === 'staff' ? {} : { tab: k }, { replace: true }); } });
  const body = h('div', { class: 'st-body' });
  const el = h('div', { class: 'staff' }, h('div', { class: 'page-head' }, h('h1', null, 'Сотрудники'), h('span', { class: 'hint' }, 'Кто за что отвечает: уведомления приходят людям своей зоны.')), note, tabsKit.el, body);

  const drawTabs = () => tabsKit.set(tab);

  function drawNote() {
    const un = zones?.unassigned || [];
    if (!un.length) { note.replaceChildren(); return; }
    const byCode = new Map((zones.items || []).map((z) => [z.code, z]));
    note.replaceChildren(h('div', { class: 'st-banner', role: 'status' },
      h('span', null, h('b', null, 'Не назначено: ' + un.map((z) => z.name).join(', ')), ' — назначьте ответственных, иначе уведомления уйдут директору.'),
      h('span', { class: 'st-banner-acts' }, ...un.map((z) => button({ label: 'Назначить: ' + z.name, size: 'S', onClick: () => openPanel('zonecard', byCode.get(z.code)?.id) })))));
  }

  const chips = (list) => (list?.length ? h('span', { class: 'st-zones' }, ...list.map((z) => h('span', { class: 'tag dim' }, z.name))) : h('span', { class: 'muted small' }, 'нет зон'));

  // СВ-4: вход на сайт есть, а сотрудника нет — связать с сотрудником или создать его
  function loginsBlock(items) {
    const list = staff?.loginsWithoutPerson || [];
    if (!list.length) return null;
    const free = items.filter((p) => !p.hasLogin);
    const byId = new Map(items.map((p) => [p.id, p]));
    const act = (e, fn, ok) => busy(e, async () => { try { await fn(); toast(ok); load(true); } catch (ex) { toastError(ex, 'связать вход'); } });
    const link = (pid, uid) => api(`/staff/${pid}/login`, { method: 'PUT', body: { userId: uid } });
    return h('section', { class: 'st-block' },
      h('h3', { class: 'section-title' }, `Входы без сотрудника (${list.length})`),
      h('p', { class: 'hint' }, 'Эти люди входят на сайт, но не связаны с сотрудником — им не приходят уведомления зон. Свяжите каждого.'),
      h('ul', { class: 'st-list' }, ...list.map((u) => {
        const sug = u.suggestPersonId && byId.get(u.suggestPersonId);
        const sel = enhanceSelect(kitSelect({ label: 'Сотрудник для входа ' + u.displayName, options: [['', 'Выбрать сотрудника…'], ...free.map((p) => [p.id, p.name])] }));
        sel.onchange = (e) => { if (sel.value) act(e, () => link(sel.value, u.userId), 'Вход связан'); };
        return h('li', { class: 'st-row' },
          h('span', { class: 'st-main' }, h('b', null, u.displayName), h('span', { class: 'muted small' }, 'логин ' + u.username)),
          sug ? button({ label: `Это ${sug.name} — связать`, kind: 'primary', size: 'S', onClick: (e) => act(e, () => link(sug.id, u.userId), 'Вход связан') }) : null,
          free.length ? sel : null,
          button({ label: 'Создать сотрудника', size: 'S', onClick: (e) => act(e, () => api('/staff/from-login', { method: 'POST', body: { userId: u.userId } }), 'Сотрудник создан') }));
      })));
  }

  function drawStaff() {
    const items = staff?.items || [];
    const logins = loginsBlock(items);
    if (!items.length) { body.replaceChildren(...[logins, kitEmpty({ title: 'Сотрудников пока нет', hint: 'Добавьте их в «Данных → Сотрудники» — они появятся здесь.' })].filter(Boolean)); return; }
    body.replaceChildren(...[logins, h('ul', { class: 'st-list' }, ...items.map((p) => h('li', null, row({
      cls: 'st-row', onClick: () => openPanel('staffcard', p.id),
      title: p.name,
      meta: [p.position, p.statusLabel && p.statusLabel !== 'Работает' ? p.statusLabel : ''].filter(Boolean).join(' · ') || 'должность не указана',
      side: [
        h('span', { title: p.hasLogin ? 'Получает уведомления' : 'Сотрудник не связан со входом — ему не приходят уведомления' },
          badge(p.hasLogin ? 'вход: ' + (p.login?.username || 'связан') : 'нет входа — открыть и дать вход', p.hasLogin ? 'ok' : 'warn')),
        chips(p.zones),
      ],
    }))))].filter(Boolean));
  }

  function drawZones() {
    const items = zones?.items || [];
    if (!items.length) { body.replaceChildren(kitEmpty({ title: 'Зон пока нет', hint: 'Зона — направление, за которое отвечают люди; им приходят уведомления этой зоны.' })); return; }
    body.replaceChildren(h('ul', { class: 'st-list' },
      ...items.map((z) => h('li', null, row({
        cls: 'st-row' + (z.active ? '' : ' off'), onClick: () => openPanel('zonecard', z.id),
        title: z.name + (z.active ? '' : ' (скрыта)'),
        meta: z.hint || '',
        side: [
          z.empty ? h('span', { class: 'st-none' }, 'Нет людей') : h('span', { class: 'st-zones' }, ...z.people.map((p) => h('span', { class: 'tag dim', title: p.hasLogin ? '' : 'Не связан со входом' }, p.name + (p.hasLogin ? '' : ' ·')))),
          h('span', { class: 'btn btn-sm' }, 'Назначить'),
        ],
      })))));
  }

  const draw = () => { drawTabs(); drawNote(); if (tab === 'zones') drawZones(); else drawStaff(); };
  async function load(silent) {
    if (!silent) body.replaceChildren(busyBlock('Загружаем сотрудников…'));
    try {
      [zones, staff] = await Promise.all([api('/zones'), api('/staff')]);
      draw();
    } catch (e) { if (silent && zones) return; note.replaceChildren(); drawTabs(); body.replaceChildren(failBlock(e, () => load())); }
  }
  load();
  return {
    el,
    reload: () => load(true),
    update: (p) => { const t = tabOf(p); if (t !== tab) { tab = t; if (zones) draw(); } },
  };
}

// ─── карточка сотрудника ───────────────────────────────────────────────────────────────────────────────
function loginBlock(p, logins, ctx) {
  const sel = enhanceSelect(h('select', { 'aria-label': 'Вход в приложение' }, h('option', { value: '' }, '— без входа —'),
    ...logins.map((l) => {
      const taken = l.personId && l.personId !== p.id;
      return h('option', { value: l.userId, disabled: !!taken }, `${l.displayName || l.username} (${l.username})${taken ? ' — занят: ' + (l.personName || 'другой сотрудник') : ''}`);
    })));
  sel.value = p.login?.userId || '';
  const save = button({ label: 'Сохранить вход', kind: 'primary', onClick: (e) => busy(e, async () => {
    try { await api(`/staff/${p.id}/login`, { method: 'PUT', body: { userId: sel.value || null } }); toast(sel.value ? 'Вход связан' : 'Вход отвязан'); ctx.reload(); } catch (ex) { toastError(ex, 'связать вход'); }
  }) });
  return section({ title: 'Вход в приложение', tone: 'who', open: !p.hasLogin, body: [
    p.hasLogin ? null : h('p', { class: 'hint warn' }, 'Сотрудник не связан со входом — ему не приходят уведомления.'),
    h('label', { class: 'field' }, h('span', null, 'Пользователь'), sel), actions(save)] });
}

function zonesBlock(p, zoneList, ctx) {
  const on = new Set(p.zoneCodes || []);
  const reason = h('input', { maxlength: 300, placeholder: 'Например: заменяет на время отпуска', 'aria-label': 'Комментарий к изменению зон' });
  const save = button({ label: 'Сохранить зоны', kind: 'primary', onClick: (e) => busy(e, async () => {
    try { await api(`/staff/${p.id}/zones`, { method: 'PUT', body: { zoneCodes: [...on], note: reason.value.trim() || undefined } }); toast('Зоны сохранены'); ctx.reload(); } catch (ex) { toastError(ex, 'сохранить зоны'); }
  }) });
  return section({ title: 'Зоны ответственности', tone: 'who', count: on.size, open: true, body: [
    h('div', { class: 'st-checks' }, ...zoneList.filter((z) => z.active || on.has(z.code)).map((z) => h('div', null, check(z.name, on.has(z.code), (v) => (v ? on.add(z.code) : on.delete(z.code))), z.hint ? h('div', { class: 'hint st-hint' }, z.hint) : null))),
    h('label', { class: 'field' }, h('span', null, 'Комментарий (необязательно)'), reason), actions(save)] });
}

const day = (v) => (v ? dateTime(v).slice(0, 10) : '');
function historyBlock(p) {
  const zs = p.history?.zones || [], hs = p.history?.handoffs || [];
  const NAME = { supplyrequest: 'заявка', salesorder: 'заказ', designtask: 'задача проектирования' };
  return section({ title: 'История', tone: 'who', count: zs.length + hs.length, body: [
    zs.length ? h('ul', { class: 'st-hist' }, ...zs.map((z) => h('li', null, h('b', null, z.zoneName || z.zoneCode), ` · с ${day(z.from)}${z.to ? ' по ' + day(z.to) : ' — сейчас'}`, z.note ? h('span', { class: 'muted' }, ' · ' + z.note) : null)))
      : h('p', { class: 'hint' }, 'Зоны этому сотруднику ещё не назначали.'),
    hs.length ? h('ul', { class: 'st-hist' }, ...hs.map((x) => h('li', null, `${NAME[x.entity] || x.entity}: `, h('b', null, x.from || 'без ответственного'), ' → ', h('b', null, x.to || 'снят'), ` · ${day(x.at)}${x.by ? ' · ' + x.by : ''}`))) : h('p', { class: 'hint' }, 'Передач объектов не было.')] });
}

export const staffCard = {
  id: 'staffcard',
  title: 'Сотрудник',
  get: async (id) => {
    const [p, logins, zs] = await Promise.all([api(`/staff/${id}`), api('/staff/logins'), api('/zones')]);
    return { ...p, id: p.id || id, _logins: logins.items || [], _zones: zs.items || [] };
  },
  card: {
    heading: (r) => r.name,
    subheading: (r) => [r.position, r.statusLabel].filter(Boolean).join(' · '),
    noHistory: true,
    view: (r) => [['Телефон', r.phone], ['Вход', r.login ? `${r.login.displayName || r.login.username} (${r.login.username})` : '']],
    zones: { extra: 'side' }, // УПР-3: вход и зоны — боковой колонкой
    extra: (r, ctx) => stack(loginBlock(r, r._logins, ctx), zonesBlock(r, r._zones, ctx), historyBlock(r)),
  },
};

// СВ-10: что приходит людям зоны — список событий сервера (zone-routing.ts, notifyZone); новой зоне событий нет
const ZONE_EVENTS = {
  contracts: ['Заказы', ['новый заказ']],
  design_dispatch: ['Проектирование', ['задача без исполнителя']],
  design: ['Проектирование', ['вам назначена задача']],
  supply: ['Заявки', ['новая заявка', 'вам передана заявка']],
  stock: ['Склад', ['заказано у поставщика — ждём поставку, принять на склад']],
  accounting: ['Деньги', ['счёт к оплате (заявка заказана, не оплачена)']],
  passports: ['Паспорта', []],
  management: ['Все разделы', ['всё, что не назначено в других зонах']],
};
function zoneEvents(code) {
  const [sect, events] = ZONE_EVENTS[code] || ['—', []];
  return section({ title: 'Что приходит людям зоны', tone: 'who', count: events.length, body: [
    h('p', null, 'Раздел: ' + sect),
    events.length ? h('ul', null, ...events.map((t) => h('li', null, t))) : h('p', { class: 'hint' }, 'Пока без уведомлений — их добавят позже.')] });
}

// ─── карточка зоны ─────────────────────────────────────────────────────────────────────────────────────
function zoneEditor(z, everyone, ctx) {
  const name = h('input', { maxlength: 40, value: z.name || '', placeholder: 'Например: Закупки', 'aria-label': 'Название зоны' });
  const hint = h('textarea', { rows: 2, maxlength: 300, 'aria-label': 'Подсказка' }); hint.value = z.hint || '';
  const members = new Set((z.people || []).map((x) => x.id));
  const was = new Set(members);
  let active = z.active !== false;
  const save = button({ label: 'Сохранить', kind: 'primary', onClick: (e) => busy(e, async () => {
    const nm = name.value.trim();
    if (!nm) { toastError(new Error('Впишите название зоны.')); return; }
    try {
      await api(`/zones/${z.id}`, { method: 'PATCH', body: { name: nm, hint: hint.value.trim(), active } });
      for (const p of everyone) {
        if (members.has(p.id) === was.has(p.id)) continue;
        const codes = new Set(p.zoneCodes || []);
        if (members.has(p.id)) codes.add(z.code); else codes.delete(z.code);
        await api(`/staff/${p.id}/zones`, { method: 'PUT', body: { zoneCodes: [...codes] } });
      }
      toast('Зона сохранена');
      ctx.reload();
    } catch (ex) { toastError(ex, 'сохранить зону'); }
  }) });
  const del = !z.system ? button({ label: 'Удалить зону', kind: 'danger', onClick: async () => {
    if (!(await confirmDlg(`Удалить зону «${z.name}»?`, 'Зона исчезнет из списка. Если в ней есть люди, сначала снимите их.', { okText: 'Удалить', danger: true }))) return;
    try { await api(`/zones/${z.id}`, { method: 'DELETE' }); toast('Зона удалена'); go('staff', { tab: 'zones' }, { replace: true }); } catch (ex) { toastError(ex, 'удалить зону'); }
  } }) : null;
  return stack(
    section({ title: 'Зона', tone: 'who', open: true, body: [
      h('label', { class: 'field' }, h('span', null, 'Название'), name),
      h('label', { class: 'field' }, h('span', null, 'Подсказка — за что отвечает зона'), hint),
      check('Показывать зону', active, (v) => { active = v; }),
      z.system ? h('p', { class: 'hint' }, 'Базовую зону удалить нельзя — её можно переименовать или скрыть.') : null] }),
    zoneEvents(z.code),
    section({ title: 'Кто отвечает', tone: 'who', count: members.size, open: true, body: [
      everyone.length ? h('div', { class: 'st-checks' }, ...everyone.map((p) => check(p.name + (p.hasLogin ? '' : ' (не получит уведомления — нет входа)'), members.has(p.id), (v) => (v ? members.add(p.id) : members.delete(p.id)))))
        : h('p', { class: 'hint' }, 'Сотрудников нет.')] }),
    actions(save, del));
}

export const zoneCard = {
  id: 'zonecard',
  title: 'Зона',
  get: async (id) => {
    const [zs, st] = await Promise.all([api('/zones'), api('/staff')]);
    const z = (zs.items || []).find((x) => x.id === id);
    if (!z) throw new Error('Зона не найдена — возможно, её удалили.');
    return { ...z, _staff: st.items || [] };
  },
  card: {
    heading: (r) => r.name,
    subheading: (r) => (r.empty ? 'Нет людей — не назначено' : ''),
    noHistory: true,
    view: () => [],
    extra: (r, ctx) => zoneEditor(r, r._staff, ctx),
  },
};
