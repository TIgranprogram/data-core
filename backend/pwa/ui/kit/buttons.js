import { h } from '../../core/dom.js';
import { mark } from './mark.js';

/** button({ label, kind: 'primary'|'secondary'|'ghost'|'danger', size: 'M'|'S', icon?, onClick, busy?, disabled?, title?, type?, cls? }) → .btn (cls — только для раскладки/состояния: mob-arr-accept и т.п.) */
export function button({ label, kind = 'secondary', size = 'M', icon, onClick, busy = false, disabled = false, title, type = 'button', cls: extra } = {}) {
  const cls = ['btn', kind === 'primary' ? 'btn-primary' : kind === 'ghost' ? 'btn-ghost' : kind === 'danger' ? 'btn-danger' : '', size === 'S' ? 'btn-sm' : '', busy ? 'is-busy' : '', extra || ''].filter(Boolean).join(' ');
  return mark(h('button', { type, class: cls, disabled: disabled || busy, title, onclick: onClick }, icon || null, label), 'button');
}

/** iconButton({ icon, label (aria), onClick, size: 'S'|'M', menu?, title?, cls? }) → .btn.btn-ghost.k-icon; menu → aria-haspopup */
export function iconButton({ icon, label, onClick, size = 'M', menu = false, title, cls } = {}) {
  const c = ['btn', 'btn-ghost', 'k-icon', size === 'S' ? 'btn-sm' : '', cls || ''].filter(Boolean).join(' ');
  return mark(h('button', { type: 'button', class: c, 'aria-label': label, title: title || label, 'aria-haspopup': menu ? 'menu' : null, 'aria-expanded': menu ? 'false' : null, onclick: onClick }, icon), 'iconButton');
}
