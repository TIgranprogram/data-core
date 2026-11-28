import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { catArt, typeArt, typeIconList } from './cat-art.js';

test('Все иллюстрации типов и основных категорий ведут на локальные WebP', async () => {
  const types = typeIconList();
  assert.equal(new Set(types.map(entry => entry.key)).size, types.length);
  const examples = ['Трубы', 'Листы', 'Метизы', 'Расходники', 'Стекло', 'Оборудование', 'Покупные изделия', 'Без категории', 'Скамьи', 'Урны', 'Качели',
    'Основной склад', 'Велопарковки', 'Указатели', 'Навесы', 'Ограждения', 'Шахматные столы',
    'Трибуны', 'Вазоны', 'Горки', 'Карусели', 'Качалки на пружине', 'Балансиры', 'Песочницы',
    'Домики', 'Сети', 'Игровые комплексы', 'Игровое оборудование', 'Детский спорт',
    'Полосы препятствий', 'Воркаут', 'Тренажёры', 'Спорт'];
  const roots = examples.map(catArt);
  assert.equal(new Set(roots).size, examples.length);
  await Promise.all([...roots, ...types.map(entry => entry.svg)].map(async markup => {
    const url = new URL(markup.match(/src="([^"]+)"/)[1]);
    assert.equal(url.protocol, 'file:');
    const bytes = await readFile(url);
    assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
    assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  }));
});

test('Крепёж различной конструкции имеет разные предметные изображения', () => {
  for (const family of [
    ['Болт мебельный', 'Болт с гайкой', 'Болт с шестигр. головкой'],
    ['Гайка колпачковая', 'Гайка с пластиковой вставкой', 'Гайка шестигр'],
    ['Заклёпка вытяжная', 'Заклепка КРЕП-КОМП с внутр. резьбой'],
    ['Саморез', 'Саморез по металлу', 'Саморез кровельный'],
  ]) assert.equal(new Set(family.map(typeArt)).size, family.length);
});
