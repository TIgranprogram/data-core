import { api, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toast } from '../../ui/toast.js';

/** ПН: полоска «последний / следующий» номера; «Следующий №» можно поправить (admin/director/владелец). */
const canEdit = () => session.role === 'admin' || session.role === 'director' || !!session.user?.isOwner;
const HINT = 'Если номера шли в другой программе — поставьте следующий свободный, дальше пойдёт +1';
const copy = async (text) => { try { await navigator.clipboard.writeText(String(text)); toast('Скопировано'); } catch { toast(String(text)); } };

export function numbersStrip() {
  const box = h('div', { class: 'pn-strip', 'aria-label': 'Следующие номера' });
  const piece = (label, val) => h('span', { class: 'pn-item' }, h('span', { class: 'pn-lab' }, label),
    val ? h('button', { type: 'button', class: 'pn-num', title: 'Нажмите, чтобы скопировать', 'aria-label': `${label} ${val} — скопировать`, onclick: () => copy(val) }, String(val), h('span', { class: 'pn-copy', 'aria-hidden': 'true' }, '⧉')) : h('span', { class: 'muted' }, '—'));
  const render = (n) => box.replaceChildren(piece('Последний паспорт №', n.lastPassportNo), nextPiece(n), piece('Талон', n.nextWarrantyCode), piece('Изделие №', n.nextProductCode));
  const nextPiece = (n) => {
    const el = piece('Следующий №', n.nextPassportNo);
    if (canEdit()) el.append(h('button', { type: 'button', class: 'btn btn-ghost pn-edit', title: HINT, onclick: () => edit(n, el) }, '✎ Изменить'));
    return el;
  };
  const edit = (n, el) => {
    const inp = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': 'Следующий номер паспорта', title: HINT, class: 'pn-input', value: n.nextPassportNo ?? '' });
    const err = h('div', { class: 'pn-err', role: 'alert' });
    const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'Сохранить');
    const cancel = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => render(n) }, 'Отмена');
    save.onclick = async () => {
      err.textContent = '';
      const next = Number(inp.value.trim());
      if (!/^\d+$/.test(inp.value.trim()) || next < 1) { err.textContent = 'Введите число'; return; }
      save.classList.add('is-busy'); save.disabled = true;
      try {
        const r = await api('/passports/next-number', { method: 'PUT', body: { next } });
        render(r); toast(`Следующий паспорт получит № ${r.nextPassportNo ?? next}`);
      } catch (e) { err.textContent = e.message || 'Не удалось сохранить'; save.classList.remove('is-busy'); save.disabled = false; }
    };
    el.replaceChildren(h('span', { class: 'pn-lab' }, 'Следующий №'), h('span', { class: 'pn-form' }, inp, save, cancel), err);
    inp.focus();
  };
  const refresh = async () => {
    try { render(await api('/passports/next-numbers')); } catch { box.replaceChildren(); }
  };
  refresh();
  return box;
}
