import { stepFunnel } from '../../../ui/kit/index.js';
import { funnelData } from './api.js';

/**
 * Шаги 1–3 воронки паспорта: Категория → Группа → признаки (kit.stepFunnel, локальный вариант onChange).
 * Шаги и числа приходят с сервера (A2) и зависят от уже выбранного. Значение «Признак не указан» — служебное none:
 * изделия без значения этого признака (на сервер уходит f=none:<код признака>).
 *   pickSteps({ getQ, onData, onChange(P, key) }) → { el, update(P), order(), labelOf(key, id), recap(P) }
 */
const NONE = 'none';
const ids = (v) => String(v ?? '').split(',').filter(Boolean);

export function pickSteps({ getQ, onData, onChange }) {
  const steps = []; // меняется на месте после каждого ответа сервера
  const labels = new Map(); // «ключ:id» → подпись, чтобы выбранное не терялось, когда срез сузился
  const stepLabels = new Map();

  /** Параметры запроса из выбранного: категория, группа, остальное — списком f. */
  const query = (P) => ({
    category: P.category, group: P.group, q: getQ(),
    f: Object.entries(P).filter(([k, v]) => v && k !== 'category' && k !== 'group').flatMap(([k, v]) => ids(v).map((id) => (id === NONE ? `none:${k}` : id))).join(','),
  });

  const fun = stepFunnel({
    steps, title: 'Какое изделие',
    onChange: (P, key) => onChange?.(P, key),
    load: async (P) => {
      const resp = await funnelData(query(P));
      steps.splice(0, steps.length, ...(resp.steps || []).map((s) => {
        stepLabels.set(s.key, s.label);
        return { key: s.key, label: s.label, multi: !!s.multi, always: s.key === 'category' || s.key === 'group' };
      }));
      const data = {};
      for (const s of resp.steps || []) {
        const vals = (s.values || []).map((v) => { labels.set(s.key + ':' + v.id, v.label); return { value: v.id, label: v.label, n: v.count, thumb: v.thumb }; });
        if (s.none > 0 && s.key !== 'category' && s.key !== 'group') vals.push({ value: NONE, label: 'Признак не указан', n: s.none });
        for (const id of ids(P[s.key])) if (!vals.some((v) => String(v.value) === id)) vals.push({ value: id, label: labels.get(s.key + ':' + id) || id, n: 0 });
        data[s.key] = vals;
      }
      onData?.(resp);
      return data;
    },
  });

  return {
    el: fun.el,
    update: (P) => fun.update(P),
    order: () => steps.map((s) => s.key),
    labelOf: (key, id) => (id === NONE ? 'не указан' : labels.get(key + ':' + id) || ''),
    /** Выбранное строками «Категория: Силовой» (для свёрнутого вида). */
    recap: (P) => Object.entries(P).filter(([, v]) => v).map(([k, v]) => [stepLabels.get(k) || k, ids(v).map((id) => (id === NONE ? 'не указан' : labels.get(k + ':' + id) || id)).join(', ')]),
  };
}
