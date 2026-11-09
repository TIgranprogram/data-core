import { sideNote, stack, toastError } from '../../../ui/kit/index.js';
import { jointsPick } from '../traits.js';
import { putDefaults } from './api.js';

/**
 * Шаг «Конструкция» (C054): как соединено — болты / сварка / цельное (без крепежа), можно несколько.
 * Ответ пишется в изделие (passportDefaults.joints) и не спрашивается дважды; от него зависят пункты текста и таблица осмотра.
 *   jointsBlock({ prod, onChange(list) }) → { el }
 */
export function jointsBlock({ prod, onChange }) {
  let saved = (prod.passportDefaults?.joints || []).map(String);
  const pick = jointsPick(saved);
  pick.el.addEventListener('change', async () => {
    const joints = JSON.parse(pick.value);
    const prev = saved.slice();
    try {
      await putDefaults(prod, { joints });
      saved = joints;
      onChange?.(joints);
    } catch (e) {
      pick.value = JSON.stringify(prev);
      toastError(e, 'сохранить конструкцию');
    }
  });
  return { el: stack(
    sideNote('Как соединены детали. Болты и сварку можно вместе; «Цельное (без крепежа)» снимает остальные. Выбор запомнится в изделии; от него зависят пункты текста и таблица осмотра.'),
    pick.el) };
}
