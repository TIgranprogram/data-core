import test from 'node:test';
import assert from 'node:assert/strict';
import { installationTextPicker } from './installation-text.js';

const rows = [{ id: 'concrete', montage: 'Забетонировать опоры.' }, { id: 'anchor', montage: 'Закрепить анкерами.' }, { id: 'empty', montage: '' }];
function form(text = '') {
  return { values: { installation: text }, get(key) { return this.values[key]; }, set(key, value) { this.values[key] = value; } };
}
test('пустой монтаж заполняется при выборе и при открытии сохранённого способа', () => {
  const f = form();
  const pick = installationTextPicker(f, rows, '');
  pick('concrete');
  assert.equal(f.values.installation, 'Забетонировать опоры.');
  const reopened = form();
  installationTextPicker(reopened, rows, 'anchor');
  assert.equal(reopened.values.installation, 'Закрепить анкерами.');
});
test('смена способа заменяет автоматический текст, пустой способ не оставляет чужой монтаж', () => {
  const f = form('Забетонировать опоры.');
  const pick = installationTextPicker(f, rows, 'concrete');
  pick('anchor');
  assert.equal(f.values.installation, 'Закрепить анкерами.');
  pick('empty');
  assert.equal(f.values.installation, '');
});
test('свой текст сохраняется и при открытии, и при нескольких сменах способа', () => {
  const f = form('Монтаж по проекту площадки.');
  const pick = installationTextPicker(f, rows, 'concrete');
  pick('anchor'); pick('empty');
  assert.equal(f.values.installation, 'Монтаж по проекту площадки.');
});
