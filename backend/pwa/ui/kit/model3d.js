import { h } from '../../core/dom.js';

/*
 * model3d({ url, alt, hoverSpin }) → блок просмотра 3D-модели (GLB). Эталон kit «3D»: без постоянного вращения —
 * модель стоит; на компьютере крутится, пока на неё наведена мышь; мышью/пальцем — повернуть и приблизить.
 * Просмотрщик (vendor/model-viewer.min.js, ~1 МБ) грузится только при первом показе. На телефоне сначала кнопка
 * «Показать 3D-модель» — тяжёлое не грузим без нажатия.
 */
let loader = null;
const loadViewer = () => (loader ??= import('../../vendor/model-viewer.min.js').catch((e) => { loader = null; throw e; }));

export function model3d({ url, alt = '', autoload = !matchMedia('(pointer: coarse)').matches } = {}) {
  const stage = h('div', { class: 'k-3d' });
  const show = async () => {
    stage.replaceChildren(h('div', { class: 'muted k-3d-msg' }, 'Загружаю 3D-модель…'));
    try { await loadViewer(); } catch { stage.replaceChildren(h('div', { class: 'muted k-3d-msg' }, 'Просмотр 3D не загрузился. Обновите страницу.')); return; }
    const mv = document.createElement('model-viewer');
    for (const [k, v] of [['src', url], ['alt', alt], ['camera-controls', ''], ['touch-action', 'pan-y'], ['interaction-prompt', 'none'],
      ['shadow-intensity', '0.6'], ['auto-rotate-delay', '0'], ['rotation-per-second', '24deg']]) mv.setAttribute(k, v);
    mv.className = 'k-3d-view';
    mv.append(h('div', { slot: 'progress-bar' })); // своя полоса загрузки не нужна: пока грузится — подпись выше
    // вращение — только пока мышь над моделью (не грузит видеокарту, когда на неё не смотрят)
    mv.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') mv.setAttribute('auto-rotate', ''); });
    mv.addEventListener('pointerleave', () => mv.removeAttribute('auto-rotate'));
    mv.addEventListener('error', () => stage.replaceChildren(h('div', { class: 'muted k-3d-msg' }, 'Файл модели не открылся. Проверьте, что это GLB.')));
    stage.replaceChildren(mv, h('small', { class: 'muted' }, 'Покрутить — мышью или пальцем, приблизить — колёсиком или двумя пальцами.'));
  };
  if (autoload) show();
  else stage.append(h('button', { type: 'button', class: 'btn', onclick: show }, '🧊 Показать 3D-модель'));
  return stage;
}
