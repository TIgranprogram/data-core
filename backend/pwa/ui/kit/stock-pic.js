import { PREFIX } from '../../core/api.js';
import { h } from '../../core/dom.js';

export const pic = (p) => (p ? h('img', { class: 'pic', src: PREFIX + (p.thumb || p.url), alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null);
