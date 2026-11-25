# C268 — приёмка скролла колонок досок

**Вердикт: PARTIAL.** Это не приёмка вида. Стенда, данных и снимков нет. Геометрия CSS на ≥721px для трёх досок собрана; живой `scrollHeight` не измерен.

## Версия

- База: `5dcb625c` (правки в индексе, коммита C268 ещё нет).
- Файлы: `backend/pwa/ui/base.css`, `panels.css`, `screens.css`, `ui/kit/kit.css`, `ui/kit/design-board.css`.
- Стенд: нет. Тема и ширины 390/1024/1920 не открывались. Снимков нет.

## Что сверялось

DESIGN §3.0: на ≥721px список заполняет окно, крутится тело, не страница. Для доски тело — `.col-body`, не `.table-wrap`. Замок C266 (`.shell`/`.main` `height: 100vh; overflow: hidden`) в diff не снят.

Новых классов, цветов и компонентов нет. Эталон доски тот же: `.board` → `.col` → `.col-body` → `.tcard`.

## Цепочка высоты (≥721px)

Общий предок уже был в C266: `.list-screen` → `.filter-layout` → `.ls-grid` (ряд `minmax(0,1fr)`) → `.ls-main` (колонка) → видимый `div` доски (`flex:1; min-height:0; overflow:hidden`).

| Доска | Куда садится | Дальше до `.col-body` |
|--|--|--|
| Заявки | `boardBox` → `.board.board-pics` | `.board` `flex:1; height/max-height:100%; align-items:stretch` → `.col` `max-height:100%; min-height:0` → `.col-body` `flex:1; min-height:0; overflow-y:auto` |
| В работе | `boardBox` → `.wk-wrap` → `.board.board-pics` | `.wk-wrap` тоже колонка `flex:1; min-height:0` (`panels.css` + `screens.css`), затем та же доска и `.col-body` |
| Проектирование | `boardBox` → `.design-board-layout.k-split` | сетка `height:100%; grid-template-rows:minmax(0,1fr)` → `.k-split-main` колонка → `.design-board-area` `flex:1` и ряд `minmax(0,1fr)` → `.design-board` `height/max-height:100%` → `.col` без `clamp(48vh…)` → `.col-body`. Левая очередь: `.k-split-side` `overflow-y:auto; max-height:none` |

`flex:1` на `.col-body` общий, не только для этих трёх. Колонка `.col` по-прежнему flex-колонка, поэтому тело может сжаться и крутиться.

Правила `kit.css` для `.wk-wrap` и `.design-board-layout` живут только в `@media (min-width: 1101px)`. Полосу 721–1100 закрывают `panels.css` и `design-board.css` (оба с 721px).

## Гигантский скролл страницы

Не возвращён по CSS: оболочка списка по-прежнему `overflow: hidden` и `100vh`. У проектирования на ≥721px снят `min-height: clamp(120px, 48vh, 100vh - 220px)`, из‑за которого колонка была выше оставшегося окна и обрезалась предком.

## После выкладки проверить глазами

1. ≥721px, лучше 1024 и 1920, длинная колонка: «Проектирование», «Заявки», «В работе». Колесо крутит карточки внутри колонки, низ последней карточки виден. Страница не растёт (`scrollHeight` документа ≈ высота окна).
2. «Проектирование»: левый список заказов крутится сам; вкладки «Готово / Отменено / Пауза» — панель не обрезана. Общее правило `.ls-main .board > .col { max-height:100% }` сильнее старого `.design-status-board > .col { max-height:none }`.
3. «В работе» при многих колонках: горизонтальная полоса доски на месте, вертикаль остаётся в колонке.
4. Таблица тех же трёх разделов: по-прежнему крутится таблица, не страница.
5. ≤720px в эту приёмку не входит.

## Дефекты

Подтверждённых нет. PARTIAL из‑за отсутствия браузера, не из‑за дыры в записанной цепочке.
