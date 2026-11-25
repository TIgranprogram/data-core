# C268 — отчёт

**Статус:** postrelease FAIL → правка потолка колонки → повторный выпуск.

## Сделано
1. `.col-body`: `flex:1 1 0; min-height:0; overflow-y:auto`.
2. Потолок `.col`: `max-height: calc(100dvh - 220px)` (не `100%` родителя).
3. Цепочка `flex:1 1 0` + `overflow:hidden` для заявок / `.wk-wrap` / `design-board-layout`.

## Postrelease v2.57
FAIL: `max-height:100%` при auto-высоте доски = высота контента; `.col-body` 6612×6612 без скролла. См. POSTRELEASE.md.

## Урок
Под `overflow:hidden` у списка потолок колонки — от окна (`dvh`), не процент от доски.
