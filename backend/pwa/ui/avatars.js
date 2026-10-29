import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';

/**
 * Аватары пользователей: 10 «космических» пресетов (статичный SVG, круг, тёмный космос — одинаково хорош в светлой
 * и тёмной теме), фото (миниатюра по id) или буква имени.
 *   avatarNode(user, size = 32) — user: { avatar, displayName, username, name }; avatar = 'preset:<код>' | 'photo:<id>' | null
 */
const BG = (a, b) => `<radialGradient id="@bg" cx=".35" cy=".3" r=".9"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient><clipPath id="@c"><circle cx="16" cy="16" r="16"/></clipPath>`;
const PLANET = (a, b) => `<radialGradient id="@p" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>`;
const STARS = '<circle cx="5" cy="6" r=".7" fill="#fff"/><circle cx="27" cy="9" r=".6" fill="#fff"/><circle cx="25" cy="27" r=".7" fill="#fff"/><circle cx="6" cy="25" r=".5" fill="#fff"/>';

const PRESETS = {
  saturn: { label: 'Сатурн', svg: BG('#3b3a6b', '#12122b') + PLANET('#fde7a8', '#c98f3c') +
    '<g clip-path="url(#@c)"><rect width="32" height="32" fill="url(#@bg)"/>' + STARS +
    '<ellipse cx="16" cy="16" rx="14" ry="4.2" fill="none" stroke="#e8c98a" stroke-width="1.8" transform="rotate(-20 16 16)"/>' +
    '<circle cx="16" cy="16" r="7" fill="url(#@p)"/>' +
    '<path d="M4.5 21 Q16 25 27.5 11" fill="none" stroke="#f3dca6" stroke-width="1.8" stroke-linecap="round"/></g>' },
  uranus: { label: 'Уран', svg: BG('#2a4a6a', '#0d1b2e') + PLANET('#c9f4f2', '#4fb6c2') +
    '<g clip-path="url(#@c)"><rect width="32" height="32" fill="url(#@bg)"/>' + STARS +
    '<circle cx="16" cy="16" r="8" fill="url(#@p)"/><ellipse cx="16" cy="16" rx="2.6" ry="12" fill="none" stroke="#d8fbf9" stroke-width=".9" opacity=".8" transform="rotate(8 16 16)"/></g>' },
  moon: { label: 'Луна', svg: BG('#35394f', '#0f111d') + PLANET('#f4f4ee', '#a9a9a4') +
    '<g clip-path="url(#@c)"><rect width="32" height="32" fill="url(#@bg)"/>' + STARS +
    '<circle cx="16" cy="16" r="10" fill="url(#@p)"/><circle cx="12.5" cy="13" r="2.3" fill="#8f8f8b" opacity=".7"/><circle cx="19.5" cy="18.5" r="3" fill="#8f8f8b" opacity=".65"/><circle cx="17" cy="11" r="1.3" fill="#8f8f8b" opacity=".7"/><circle cx="12" cy="20.5" r="1.4" fill="#8f8f8b" opacity=".7"/></g>' },
  sun: { label: 'Солнце', svg: BG('#ff9a3c', '#c2410c') + PLANET('#fff7c2', '#ffb703') +
    '<g clip-path="url(#@c)"><rect width="32" height="32" fill="url(#@bg)"/><circle cx="16" cy="16" r="13" fill="#ffd166" opacity=".25"/>' +
    '<circle cx="16" cy="16" r="9" fill="url(#@p)"/><g stroke="#fff3b0" stroke-width="1.4" stroke-linecap="round" opacity=".9"><path d="M16 2.5v3M16 26.5v3M2.5 16h3M26.5 16h3M6.4 6.4l2.1 2.1M23.5 23.5l2.1 2.1M25.6 6.4l-2.1 2.1M8.5 23.5l-2.1 2.1"/></g></g>' },
  earth: { label: 'Земля', svg: BG('#1f2a5c', '#090c24') + PLANET('#6ec1ff', '#1b5fb5') +
    '<g clip-path="url(#@c)"><rect width="32" height="32" fill="url(#@bg)"/>' + STARS +
    '<circle cx="16" cy="16" r="10" fill="url(#@p)"/><path d="M10 12c2-2 5-1 5 1s-2 2-2 4-3 2-4 0-1-3 1-5zM18 17c2-1 4 0 4 2s-2 3-3 2-2-3-1-4z" fill="#58b368"/><path d="M12 9q4-1 6 0" stroke="#fff" stroke-width="1" stroke-linecap="round" opacity=".6" fill="none"/></g>' },
  mars: { label: 'Марс', svg: BG('#4a2a2e', '#150c10') + PLANET('#f6a07a', '#b23a1d') +
    '<g clip-path="url(#@c)"><rect width="32" height="32" fill="url(#@bg)"/>' + STARS +
    '<circle cx="16" cy="16" r="10" fill="url(#@p)"/><circle cx="12" cy="14" r="2" fill="#8c2a14" opacity=".55"/><circle cx="19.5" cy="19" r="2.6" fill="#8c2a14" opacity=".5"/><ellipse cx="16" cy="7.2" rx="3.4" ry="1" fill="#fff" opacity=".8"/></g>' },
  jupiter: { label: 'Юпитер', svg: BG('#3a2f45', '#110d18') + PLANET('#f3d9b1', '#b67a4a') +
    '<g clip-path="url(#@c)"><rect width="32" height="32" fill="url(#@bg)"/>' + STARS +
    '<circle cx="16" cy="16" r="11" fill="url(#@p)"/><g clip-path="circle(11px at 16px 16px)"><path d="M4 11h24" stroke="#a5683c" stroke-width="2" opacity=".6"/><path d="M4 16h24" stroke="#fff4e0" stroke-width="2.2" opacity=".55"/><path d="M4 21h24" stroke="#a5683c" stroke-width="2" opacity=".6"/></g><ellipse cx="20" cy="18.6" rx="2.2" ry="1.3" fill="#c0492b" opacity=".85"/></g>' },
  neptune: { label: 'Нептун', svg: BG('#1d2f6b', '#080d26') + PLANET('#7aa2ff', '#2338b3') +
    '<g clip-path="url(#@c)"><rect width="32" height="32" fill="url(#@bg)"/>' + STARS +
    '<circle cx="16" cy="16" r="9.5" fill="url(#@p)"/><path d="M8 14q8 3 16-1M8.5 19q7 2 15-1" stroke="#c9d8ff" stroke-width="1.1" fill="none" opacity=".6" stroke-linecap="round"/><circle cx="14" cy="17" r="1.8" fill="#142080" opacity=".6"/></g>' },
  comet: { label: 'Комета', svg: BG('#2c2150', '#0c0820') +
    '<linearGradient id="@t" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#9be7ff"/><stop offset="1" stop-color="#9be7ff" stop-opacity="0"/></linearGradient>' +
    '<g clip-path="url(#@c)"><rect width="32" height="32" fill="url(#@bg)"/>' + STARS +
    '<path d="M22 10L2 28 M23 12L6 31 M20 8L0 22" stroke="url(#@t)" stroke-width="2.6" stroke-linecap="round" opacity=".9" fill="none"/><circle cx="22.5" cy="9.5" r="4.2" fill="#e9fbff"/><circle cx="22.5" cy="9.5" r="6.5" fill="#9be7ff" opacity=".25"/></g>' },
  galaxy: { label: 'Галактика', svg: BG('#2b1a4d', '#0a0618') +
    '<radialGradient id="@g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff6d8"/><stop offset=".4" stop-color="#d6a8ff"/><stop offset="1" stop-color="#6a3cc8" stop-opacity="0"/></radialGradient>' +
    '<g clip-path="url(#@c)"><rect width="32" height="32" fill="url(#@bg)"/>' + STARS +
    '<circle cx="16" cy="16" r="8" fill="url(#@g)"/><g fill="none" stroke-linecap="round"><path d="M16 16c1-5 7-6 10-2s-1 11-9 11S4 18 6 12" stroke="#c7a3ff" stroke-width="1.8" opacity=".85"/><path d="M16 16c-1 5-7 6-10 2s1-11 9-11 11 7 9 13" stroke="#8fb4ff" stroke-width="1.5" opacity=".7"/></g><circle cx="16" cy="16" r="2" fill="#fff"/></g>' },
};

export const AVATAR_PRESETS = Object.entries(PRESETS).map(([code, p]) => ({ code, label: p.label }));
let seq = 0;

/** SVG-пресет нужного размера (null — кода нет). */
export function presetNode(code, size = 32) {
  const p = PRESETS[code];
  if (!p) return null;
  const n = ++seq;
  const span = h('span', { class: 'avatar avatar-img', style: `width:${size}px;height:${size}px;background:none`, title: p.label, 'aria-hidden': 'true' });
  // статичная разметка из этого файла, данных пользователя в ней нет
  span.innerHTML = `<svg viewBox="0 0 32 32" width="${size}" height="${size}" aria-hidden="true"><defs></defs>${p.svg.replace(/@(bg|c|p|t|g)\b/g, (_, k) => k + n)}</svg>`;
  return span;
}

const photoCache = new Map();
const photoUrl = (id) => {
  if (!photoCache.has(id)) photoCache.set(id, api('/photos/' + id).then((p) => p.variants?.thumb?.storageUrl || p.storageUrl || '').catch(() => ''));
  return photoCache.get(id);
};
export const dropAvatarCache = () => photoCache.clear();

const initialsOf = (u) => {
  const name = (u?.displayName || u?.name || u?.username || '?').trim();
  return name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
};

/** Аватар пользователя: пресет → SVG, фото → миниатюра, иначе буква(ы) имени. */
export function avatarNode(user, size = 32) {
  const av = String(user?.avatar || '');
  if (av.startsWith('preset:')) { const n = presetNode(av.slice(7), size); if (n) return n; }
  const box = h('span', { class: 'avatar', style: `width:${size}px;height:${size}px;font-size:${Math.max(10, Math.round(size * 0.42))}px`, 'aria-hidden': 'true' }, initialsOf(user));
  if (av.startsWith('photo:')) {
    photoUrl(av.slice(6)).then((u) => {
      if (u) box.replaceChildren(h('img', { src: PREFIX + u, alt: '', loading: 'lazy', style: 'width:100%;height:100%;border-radius:50%;object-fit:cover', onerror: (e) => e.target.remove() }));
    });
  }
  return box;
}
