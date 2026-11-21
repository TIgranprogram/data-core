// Названия и адреса блоков «Карты сайта».
import { SECTIONS } from './help-guide-data.js';
import { BANDS, NODES } from './atlas-data.js';

export const byId = new Map(NODES.map((n) => [n.id, n]));
export const bandOf = new Map(BANDS.map((b, i) => [b.id, { ...b, i }]));
export const tone = (n) => bandOf.get(n.band).tok;
export const nameOf = (n) => (n.t === 'ИЗДЕЛИЕ' ? 'Изделие' : n.t);
/** Подпись будущего: «идея» (предложение, решает владелец) или «в разработке» (задача в очереди). */
export const planLabel = (plan) => (plan === 'идея' ? 'идея' : 'в разработке');
export const hrefOf = (n) => n.href || (n.sec ? SECTIONS[n.sec]?.href : null);
