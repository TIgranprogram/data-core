import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { getViewAs, rememberRoles, rolesForSelect, setViewAs } from '../core/view-as.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { AVATAR_PRESETS, avatarNode, presetNode } from '../ui/avatars.js';
import { getPref, setPref } from '../core/prefs.js';
import { enhanceSelect, segmented } from '../ui/kit/index.js';

/**
 * Правая панель «Мой профиль» (`?of=profile&open=me`): имя, телефон, аватар (10 пресетов или своё фото).
 * Сервер: GET/PATCH /auth/me. После сохранения шапка перерисовывается событием dc:profile.
 * «Вид экрана» (ИЗ-19) — сразу, без «Сохранить»: uiPrefs.viewScale (core/prefs.js), у каждого свой, на любом устройстве.
 */
const photoOf = (a) => (String(a || '').startsWith('photo:') ? a : null);

/** Выбор роли для просмотра. Список — GET /roles; встроенные без карточки всё равно есть. Смена только локальная. */
function viewAsField() {
  const sel = h('select', { 'aria-label': 'Смотреть как' });
  const fill = () => {
    const cur = getViewAs();
    const opts = rolesForSelect();
    sel.replaceChildren(
      h('option', { value: '' }, 'Как обычно (моя роль)'),
      ...opts.map((o) => h('option', { value: o.name }, o.label)),
    );
    sel.value = opts.some((o) => o.name === cur) ? cur : '';
  };
  fill();
  sel.addEventListener('change', () => setViewAs(sel.value || null));
  api('/roles').then((res) => { rememberRoles(res); fill(); }).catch(() => {});
  enhanceSelect(sel, { force: true });
  return h('div', { class: 'field' }, h('span', null, 'Смотреть как'), sel,
    h('small', { class: 'muted' }, 'Только просмотр: данные менять нельзя'));
}

export const profile = {
  id: 'profile',
  title: 'Мой профиль',
  get: async () => ({ ...(await api('/auth/me')), id: 'me' }),
  card: {
    heading: () => 'Мой профиль',
    subheading: (r) => r.roleLabel || '',
    noHistory: true,
    view: () => [],
    extra: (r, ctx) => {
      let avatar = r.avatar || null;
      const name = h('input', { maxlength: 80, value: r.displayName || '', placeholder: 'Как вас называть', 'aria-label': 'Имя' });
      const phone = h('input', { type: 'tel', maxlength: 30, value: r.phone || '', placeholder: '+7 …', 'aria-label': 'Телефон' });
      const preview = h('div', { class: 'pf-av-now' });
      const grid = h('div', { class: 'pf-av-grid', role: 'radiogroup', 'aria-label': 'Аватар' });
      const paint = () => {
        preview.replaceChildren(avatarNode({ avatar, displayName: name.value || r.username }, 56));
        grid.replaceChildren(...AVATAR_PRESETS.map((p) => h('button', {
          type: 'button', class: 'pf-av' + (avatar === 'preset:' + p.code ? ' on' : ''), role: 'radio', 'aria-checked': String(avatar === 'preset:' + p.code), title: p.label, 'aria-label': p.label,
          onclick: () => { avatar = 'preset:' + p.code; paint(); },
        }, presetNode(p.code, 40))));
      };
      const file = h('input', { type: 'file', accept: 'image/*', hidden: true });
      const upBtn = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => file.click() }, 'Загрузить своё фото');
      file.addEventListener('change', async () => {
        const f = file.files[0]; file.value = '';
        if (!f) return;
        upBtn.classList.add('is-busy'); upBtn.disabled = true;
        try {
          const fd = new FormData(); fd.append('file', f, f.name || 'avatar.png');
          const ph = await api('/photos/upload', { method: 'POST', body: fd });
          avatar = 'photo:' + String(ph._id || ph.id); paint();
        } catch (e) { toastError(e, 'загрузить фото'); } finally { upBtn.classList.remove('is-busy'); upBtn.disabled = false; }
      });
      name.addEventListener('input', () => { if (!avatar) paint(); });
      const save = h('button', { type: 'button', class: 'btn btn-primary', onclick: async (e) => {
        const btn = e.currentTarget; btn.classList.add('is-busy'); btn.disabled = true;
        try {
          const me = await api('/auth/me', { method: 'PATCH', body: { displayName: name.value.trim(), phone: phone.value.trim(), avatar } });
          session.user = { ...session.realUser, ...me };
          window.dispatchEvent(new CustomEvent('dc:profile'));
          toast('Профиль сохранён');
          ctx.reload?.();
        } catch (ex) { toastError(ex, 'сохранить профиль'); } finally { btn.classList.remove('is-busy'); btn.disabled = false; }
      } }, 'Сохранить');
      // ИЗ-19: крупный вид — сразу на экране, сохраняется у пользователя
      const VIEWS = [{ v: 'normal', label: 'Обычный' }, { v: 'large', label: 'Крупный' }];
      const viewSeg = segmented({ items: VIEWS.map((o) => ({ key: o.v, label: o.label })), value: getPref('viewScale') === 'large' ? 'large' : 'normal', label: 'Вид экрана', onChange: (k) => setPref('viewScale', k === 'large' ? 'large' : '') });
      const viewAs = session.canViewAs ? viewAsField() : null;
      paint();
      return h('div', { class: 'pf-profile' },
        h('div', { class: 'pf-av-head' }, preview, h('div', null, h('b', null, r.displayName || r.username || ''), h('div', { class: 'muted' }, r.roleLabel || ''))),
        h('label', { class: 'field' }, h('span', null, 'Имя'), name),
        h('label', { class: 'field' }, h('span', null, 'Телефон'), phone),
        h('div', { class: 'field' }, h('span', null, 'Аватар'), grid,
          h('div', { class: 'pf-av-up' }, upBtn, photoOf(avatar) ? h('span', { class: 'muted' }, 'Выбрано своё фото') : null), file),
        h('div', { class: 'field' }, h('span', null, 'Вид экрана'), viewSeg.el,
          h('small', { class: 'muted' }, 'Крупный — фото, текст, поля и кнопки больше. Меняется сразу, сохраняется для вас на любом устройстве.')),
        viewAs,
        h('div', { class: 'actions' }, save));
    },
  },
};
