import { api, session } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { toast } from '../../ui/toast.js';

/** ПН: полоска «последний / следующий» номера; «Следующий №» и «Изделие №» можно поправить (admin/director/владелец), талон — автоматом. */
const canEdit = () => session.role === 'admin' || session.role === 'director' || !!session.user?.isOwner;
const HINT = 'Если номера шли в другой программе — поставьте следующий свободный, дальше пойдёт +1';
const copy = async (text) => { try { await navigator.clipboard.writeText(String(text)); toast('Скопировано'); } catch { toast(String(text)); } };

export function numbersStrip() {
  const box = h('div', { class: 'pn-strip', 'aria-label': 'Следующие номера' });
  const piece = (label, val) => h('span', { class: 'pn-item' }, h('span', { class: 'pn-lab' }, label),
    val ? h('button', { type: 'button', class: 'pn-num', title: 'Нажмите, чтобы скопировать', 'aria-label': `${label} ${val} — скопировать`, onclick: () => copy(val) }, String(val), h('span', { class: 'pn-copy', 'aria-hidden': 'true' }, '⧉')) : h('span', { class: 'muted' }, '—'));
  const render = (n) => box.replaceChildren(piece('Последний паспорт №', n.lastPassportNo), nextPiece(n), piece('Талон', n.nextWarrantyCode), codePiece(n));
  // поле: [подпись, ключ ответа, ключ запроса, подпись в сообщении]
  const PASS = ['Следующий №', 'nextPassportNo', 'next', 'Следующий паспорт получит №'];
  const CODE = ['Изделие №', 'nextProductCode', 'nextProductCode', 'Следующее изделие получит №'];
  const editable = (n, f) => {
    const el = piece(f[0], n[f[1]]);
    if (canEdit()) el.append(h('button', { type: 'button', class: 'btn btn-ghost pn-edit', title: HINT, onclick: () => edit(n, el, f) }, '✎ Изменить'));
    return el;
  };
  const nextPiece = (n) => editable(n, PASS);
  const codePiece = (n) => editable(n, CODE);
  const edit = (n, el, f) => {
    const inp = h('input', { type: 'text', inputmode: 'numeric', 'aria-label': f[0], title: HINT, class: 'pn-input', value: n[f[1]] ?? '' });
    const err = h('div', { class: 'pn-err', role: 'alert' });
    const save = h('button', { type: 'button', class: 'btn btn-primary' }, 'Сохранить');
    const cancel = h('button', { type: 'button', class: 'btn btn-ghost', onclick: () => render(n) }, 'Отмена');
    save.onclick = async () => {
      err.textContent = '';
      const v = Number(inp.value.trim());
      if (!/^\d+$/.test(inp.value.trim()) || v < 1) { err.textContent = 'Введите число'; return; }
      save.classList.add('is-busy'); save.disabled = true;
      try {
        const r = await api('/passports/next-number', { method: 'PUT', body: { [f[2]]: v } });
        render(r); toast(`${f[3]} ${r[f[1]] ?? v}`);
      } catch (e) { err.textContent = e.message || 'Не удалось сохранить'; save.classList.remove('is-busy'); save.disabled = false; }
    };
    el.replaceChildren(h('span', { class: 'pn-lab' }, f[0]), h('span', { class: 'pn-form' }, inp, save, cancel), err);
    inp.focus();
  };
  const refresh = async () => {
    try { render(await api('/passports/next-numbers')); } catch { box.replaceChildren(); }
  };
  refresh();
  return box;
}
