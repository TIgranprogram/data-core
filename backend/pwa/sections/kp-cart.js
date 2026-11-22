import { button, hint, stack } from '../ui/kit/index.js';
import { toast } from '../ui/kit/toast.js';
import { money } from '../core/format.js';
import { api } from '../core/api.js';
import { createPack, sumOf, writePrefs } from './offers/funnel/api.js';
import { firmsStep } from './offers/funnel/firms-step.js';

const KEY = 'dc-kp';
export const loadCart = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
export const saveCart = (lines) => { try { localStorage.setItem(KEY, JSON.stringify(lines)); } catch { /* приватный режим */ } };
export const kpCount = () => loadCart().length;
export function kpAdd(r) {
  const lines = loadCart();
  const desc = String(r.description || '').trim();
  const line = lines.find((l) => l.id === r.id);
  if (line) { line.qty += 1; if (!line.description && desc) line.description = desc; }
  else lines.push({
    id: r.id, sku: r.sku, name: r.name, price: r.price ?? 0, qty: 1,
    unit: r.unit || 'шт',
    color: r.color || (Array.isArray(r.colors) && r.colors[0]) || '',
    size: r.size || (Array.isArray(r.sizes) && r.sizes[0]) || '',
    photoUrl: r.photo?.thumb || r.photo?.url || null,
    description: desc,
  });
  saveCart(lines);
}

export async function fillCartDescriptions(lines) {
  await Promise.all(lines.filter((l) => l.id && !l.description).slice(0, 20).map(async (l) => {
    const p = await api(`/showcase/${l.id}`).catch(() => null);
    const d = String(p?.description || '').trim();
    if (d) l.description = d;
  }));
}

export const cartOfferItems = (lines) => lines.map((l) => ({
  productId: l.id, productSku: l.sku, productName: l.name,
  quantity: Number(l.qty) || 1, unit: l.unit || 'шт',
  ...(Number(l.price) > 0 ? { unitPrice: Number(l.price) } : {}),
  ...(l.color ? { color: l.color } : {}), ...(l.size ? { size: l.size } : {}),
  ...(l.photoUrl ? { photoUrl: l.photoUrl } : {}),
  ...(l.description ? { description: l.description } : {}),
}));

export function cartPack({ companies, companyId, lines, onMode }) {
  let active = false;
  let firms;
  let setSave = () => {};
  const summary = hint('');
  const box = stack();
  box.hidden = true;
  box.tabIndex = -1;
  const open = button({ label: 'Собрать пакет КП', onClick: () => changeMode(true) });
  const back = button({ label: 'Вернуться к одному КП', kind: 'ghost', onClick: () => changeMode(false) });
  back.hidden = true;

  function problem(picked) {
    const items = lines();
    if (!items.length) return 'Добавьте изделия в КП.';
    if (items.some((l) => !(Number(l.qty) > 0))) return 'Укажите количество больше нуля.';
    if (!picked.length) return 'Отметьте хотя бы одну фирму.';
    return firms.bad();
  }

  function sync() {
    if (!active) { setSave(true, 'Создать КП'); return; }
    const picked = firms?.picked() || [];
    const error = problem(picked);
    summary.textContent = error || picked.map((f) => `${f.name} — ${money(sumOf(lines(), f.pct))}`).join(' · ');
    setSave(!error, picked.length ? `Создать ${picked.length} КП` : 'Создать пакет КП');
  }

  function changeMode(value) {
    active = value;
    box.hidden = !value;
    open.hidden = value;
    back.hidden = !value;
    if (value && !firms) {
      firms = firmsStep({ onChange: sync, companies, preferredCompanyId: companyId() });
      box.replaceChildren(firms.el, summary);
    }
    onMode(value);
    (value ? box : open).focus();
  }

  async function submit(body) {
    const picked = firms.picked();
    const error = problem(picked);
    if (error) throw new Error(error);
    const snapshot = JSON.stringify(lines());
    const res = await createPack({ ...body, companies: picked.map((f) => ({ companyId: f.id, markupPercent: f.pct })) });
    if (!Array.isArray(res?.items) || res.items.length !== picked.length || !res.items.every((item) => item?.id)) {
      throw new Error('Не удалось подтвердить создание всех КП. Проверьте список КП перед повтором.');
    }
    writePrefs({ companies: picked.map((f) => ({ id: f.id, markup: f.pct })) });
    if (JSON.stringify(loadCart()) === snapshot) saveCart([]);
    toast(`Создано КП: ${res.items.length}`);
    return res.items[0].id;
  }

  return {
    el: stack(open, back, box), get active() { return active; }, sync, submit,
    bindSave: (callback) => { setSave = callback; sync(); },
  };
}
