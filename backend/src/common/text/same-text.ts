import { escapeRe } from '../list-query';
import { normText } from './norm-text';

/** Ключ сравнения значений справочника: без учёта регистра, лишних пробелов и ё/е. */
export const sameKey = (v: unknown) => normText(v).replace(/ё/g, 'е');

/** Регулярка «поле равно значению» с теми же правилами (для запросов Mongo). */
export const sameRe = (v: unknown) => new RegExp(`^\\s*${escapeRe(String(v ?? '').trim()).replace(/\s+/g, '\\s+').replace(/[её]/gi, '[её]')}\\s*$`, 'i');
