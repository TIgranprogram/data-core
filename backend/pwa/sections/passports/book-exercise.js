import { h } from '../../core/dom.js';
import { actions, button } from '../../ui/kit/index.js';
import { srcPaint } from '../../ui/kit/src.js';
import { SRC_LABEL } from './card-blocks.js';

export const exerciseTitle = 'Инструкция упражнения';
export const exerciseFields = [['initialPosition', 'Исходное положение'], ['movement', 'Движения и завершение'], ['muscles', 'Задействованные мышцы']];
export const exerciseLength = (value) => exerciseFields.reduce((n, [key]) => n + String(value[key] ?? '').replace(/\r\n/g, '\n').trim().length, 0);

/** Только сохранённый typed-снимок: никаких подстановок из актуального изделия экземпляру. */
export function exerciseBookBlocks(ctx) {
  const value = ctx.S.r.textSnapshot?.exerciseInstructions;
  const edit = ctx.S.template && ctx.can && ctx.openExercise;
  if (!value && !edit) return [];
  const blocks = value ? [h('h3', { class: 'bk-sub bk-h' }, exerciseTitle)] : [];
  if (edit) blocks.push(actions(button({ label: value ? 'Изменить инструкцию упражнения' : 'Добавить инструкцию упражнения', size: 'S', kind: 'secondary', onClick: ctx.openExercise })));
  if (value) for (const [key, label] of exerciseFields) {
    blocks.push(h('h3', { class: 'bk-sub bk-h' }, label));
    for (const text of String(value[key] ?? '').split(/\n\s*\n/).filter(Boolean)) {
      const paragraph = h('p', { class: 'bk-p' }, text);
      if (value.source?.kind === 'product' && value.source.productId) srcPaint(paragraph, 'product', SRC_LABEL);
      blocks.push(paragraph);
    }
  }
  return blocks;
}
