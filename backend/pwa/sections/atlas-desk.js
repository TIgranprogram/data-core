export const DESK = [
  { id: 'desk', tpl: 'board', tplStatus: 'ok', band: 'quality', col: 2, sec: 'desk', t: 'Рабочий стол', l: ['личные задачи', 'и закреплённые карточки'],
    inside: [
      { id: 'zakrepit', t: 'Недавние карточки', l: 'перенос на стол за верхнюю полосу или кнопкой +, закреплённые скрываются', in: ['salesorders', 'design', 'products', 'requests'] },
      { id: 'plan', t: 'Личный план', l: 'сроки, подзадачи и стопки «В фокусе», «Запланировано», «Жду»' },
      { id: 'zavershennye', t: 'Завершённые карточки', l: 'вкладка справа, возврат в исходную стопку' },
      { id: 'sledushchiy-shag', t: 'Следующий шаг', l: 'подсказка из исходной записи и переход к связанному заказу или позиции' },
    ],
    rules: ['Стол личный. Его стопки не меняют этапы исходных записей.', 'Содержимое карточки читается с текущими правами. Стол хранит ссылки и личные задачи.'],
    docs: ['docs/crew/C221-desk-finish/TZ.md'], code: ['backend/pwa/sections/desk.js', 'backend/pwa/sections/desk-state.js', 'backend/src/modules/user/desk-layout.ts'] },
];
