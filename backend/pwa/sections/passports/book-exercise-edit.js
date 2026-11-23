import { h } from '../../core/dom.js';
import { buildForm, button, hint, stack } from '../../ui/kit/index.js';
import { confirmDlg } from '../../ui/kit/dialog.js';
import { canWorkPassport } from './common.js';
import { sideForm } from './book-template-edit.js';
import { exerciseFields, exerciseLength, exerciseTitle } from './book-exercise.js';

/** Клиентская подсказка той же проверки; окончательную валидацию выполняет сервер. */
export function normalizedExercise(raw) {
  const value = {};
  for (const [key, label] of exerciseFields) {
    const text = String(raw[key] ?? '').replace(/\r\n/g, '\n').trim();
    if (!text) throw new Error(`${label}: заполните поле`);
    if (/<[^>]*>|[{}]|\b(?:undefined|null)\b/i.test(text)) throw new Error(`${label}: нужен обычный текст без HTML и служебных подстановок`);
    value[key] = text;
  }
  if (exerciseLength(value) > 4000) throw new Error('Инструкция упражнения: общий лимит 4000 символов');
  return value;
}

/** Один модельный блок, целиком в CAS; baseline никогда не нормализуем. */
export function openExerciseInstructions(slot, template, { save, done, isCurrent }) {
  if (template?.mode !== 'template' || !canWorkPassport() || !isCurrent()) return;
  const baseline = structuredClone(template.defaults || {});
  const original = baseline.exerciseInstructions;
  const form = buildForm(exerciseFields.map(([key, label]) => ({ key, label, type: 'textarea', rows: 3, wide: true })), original || {});
  const fields = [...form.el.querySelectorAll('textarea')];
  for (const field of fields) field.removeAttribute('maxlength'); // Общий лимит проверяется явно, вставленный текст не обрезаем.
  const raw = () => Object.fromEntries(exerciseFields.map(([key], i) => [key, fields[i].value]));
  const counter = h('p', { class: 'hint', role: 'status', 'aria-label': 'Общий объём инструкции' });
  const validation = h('div', { role: 'alert', hidden: true });
  let removing = false;
  const count = () => { counter.textContent = `${exerciseLength(raw())} / 4000 символов`; };
  form.el.addEventListener('input', () => { removing = false; validation.hidden = true; count(); });
  let ui;
  const remove = original ? button({ label: 'Удалить инструкцию', kind: 'danger', size: 'S', onClick: async () => {
    if (!isCurrent() || !canWorkPassport() || !await confirmDlg('Удалить инструкцию упражнения?', 'Общие правила и ранее созданные паспорта сохранятся.', { okText: 'Удалить инструкцию', danger: true })) return;
    removing = true; ui.submit();
  } }) : null;
  ui = sideForm(slot, {
    title: exerciseTitle, form, done, confirm: true,
    extra: stack(counter, validation, hint('Только шаблон этого изделия и будущие паспорта. Общие правила и существующие экземпляры не меняются.'), remove),
    changed: () => removing || form.dirty(),
    read() {
      try {
        if (!isCurrent() || !canWorkPassport()) throw new Error('Форма устарела. Откройте инструкцию нужного изделия заново.');
        return { exerciseInstructions: removing ? null : normalizedExercise(raw()) };
      } catch (e) { validation.replaceChildren(hint(e.message, 'warn')); validation.hidden = false; return null; }
    },
    save: (change) => save(change, baseline),
  });
  count(); form.focus();
}
