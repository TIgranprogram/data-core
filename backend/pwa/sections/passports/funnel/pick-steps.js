import { funnel } from '../../../ui/kit/index.js';
import { funnelData } from './api.js';

/**
 * Шаги 1–3 воронки паспорта: Категория → Группа → признаки (эталон kit.funnel, П-1).
 * Шаги и числа приходят с сервера (A2) и зависят от уже выбранного. Значение «Признак не указан» — служебное none:
 * изделия без значения этого признака (на сервер уходит f=none:<код признака>).
 *   pickSteps({ getQ, onData, onChange(P, key) }) → { el, update(P), order(), labelOf(key, id), setDone(bool), setNext(text) }
 */
const NONE = 'none';
const ids = (v) => String(v ?? '').split(',').filter(Boolean);
const REQUIRED = ['category', 'group'];

export function pickSteps({ getQ, onData, onChange }) {
  let P = {}; let seq = 0; let steps = [];
  const labels = new Map(); // «ключ:id» → подпись, чтобы выбранное не терялось, когда срез сузился

  /** Параметры запроса из выбранного: категория, группа, остальное — списком f. */
  const query = (p) => ({
    category: p.category, group: p.group, q: getQ(),
    f: Object.entries(p).filter(([k, v]) => v && !REQUIRED.includes(k)).flatMap(([k, v]) => ids(v).map((id) => (id === NONE ? `none:${k}` : id))).join(','),
  });

  const fun = funnel({ steps: [], onChange: (key, value) => onChange?.({ ...P, [key]: value || undefined }, key) });

  async function update(next) {
    P = { ...next };
    const my = ++seq;
    let resp;
    try { resp = await funnelData(query(P)); } catch { resp = { steps: [] }; }
    if (my !== seq) return;
    steps = (resp.steps || []).map((s) => {
      const values = (s.values || []).map((v) => { labels.set(s.key + ':' + v.id, v.label); return { id: v.id, label: v.label, count: v.count, thumb: v.thumb }; });
      if (s.none > 0 && !REQUIRED.includes(s.key)) values.push({ id: NONE, label: 'Признак не указан', count: s.none });
      for (const id of ids(P[s.key])) if (!values.some((v) => String(v.id) === id)) values.push({ id, label: labels.get(s.key + ':' + id) || id, count: 0 });
      return { key: s.key, label: s.label, ask: s.key === 'category' ? 'выберите категорию' : s.key === 'group' ? 'выберите группу' : `уточните: ${String(s.label).toLowerCase()} — по желанию`, multi: !!s.multi, skip: !!s.skip, optional: !REQUIRED.includes(s.key), value: P[s.key] || '', values };
    });
    fun.update({ steps });
    onData?.(resp);
  }

  return {
    el: fun.el,
    update,
    order: () => steps.map((s) => s.key),
    labelOf: (key, id) => (id === NONE ? 'не указан' : labels.get(key + ':' + id) || ''),
    ready: () => fun.ready(),
    setDone: (done) => fun.update({ done }),
    setNext: (text) => fun.setNext(text),
  };
}
