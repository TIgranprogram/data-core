# C030 шаг 2 — frontend: эталоны kit (2026-11-07)

Статус: готово. design-lint: новых 0, итог 6925 (было 7113, ниже за счёт переноса `.hint.warn`). pwa-guards 233 зелёных, `--check` модулей ок, preload пересобран (131).
Новый модуль: `ui/kit/blocks.js` (hint, tileGrid, landing, miniChart, navList, photoStrip); остальное — опции в `ui/kit/index.js`, `table.js`, правила в `kit.css`. Все опции необязательные, прежний вид по умолчанию.

| № SPEC | Эталон / вариант | Вызов | Витрина #kit |
|--|--|--|--|
| 13 | hint | `hint(text, 'danger'/'warn'/'ok')` | «Подсказка · C030-13» |
| 12 | table pic/nowrap | `columns:[{pic:true},{nowrap:true}]` | «Колонки таблицы · C030-12» |
| 1 | card S art/low/graph/expand | `card({size:'S', art, low, graph, expand:{title,action,body}})` | «Карточка S · C030-1» |
| 1-2 | tileGrid, landing | `tileGrid(...)`, `landing({head,action,body})` | C030-1, C030-2 |
| 3 | section fixed/urgent/more | `section({fixed, urgent, more:{limit,label,onMore}})` | C030-3 |
| 4 | layout.cols | `layout.cols(...блоки)` | C030-4 |
| 5 | stat-пилюля | `stat({value,label,onClick,tone,active})` | C030-5 |
| 6 | tabs days | `tabs({layout:'days', items:[{key,label,sub,marks,today}]})` | C030-6 |
| 7 | miniChart | `miniChart({type:'bar',parts})` / `({type:'spark',points})` | C030-7 |
| 8 | navList | `navList({groups,value,onPick,label})` → `{el,set}` | C030-8 |
| 9 | photoStrip, badge dot | `photoStrip(list)`, `badge(txt,tone,{dot:hex})` | C030-9 |
| 10 | card M fields | `card({size:'M',variant:'fields',price:{value,note},body})` | C030-10 |
| 11 | card L head+tabs | `card({size:'L',head:{title,badges,menu},tabs:{items,panes:{key:()=>узел},value}})` | C030-11 |

`.hint.warn` удалён из `ui/screens.css` (база `.hint` лежит в `form.css`, не тронута). DESIGN §4 — 13 строк, §8 — одна запись.

Не сделано / риски:
- Снимки 390/1024/1920 не снимались (нужно разрешение); вид витрины глазами не проверен.
- `.stat.k-pill` радиус пилюли — `var(--s6)` (токена pill нет); нужен ли `--radius-pill` — решить дизайнеру.
- `card S expand`: обёртка `display:contents`, панель на всю строку `tileGrid`; вне сетки панель идёт блоком под плиткой.
- В `.hint.ok` / `miniChart` тона dim берётся из `.tone-dim` (base.css, hex вне kit).
- Пункт 4 SPEC (перевод экранов) не делался; `.hint:empty` у `.contract-field` оставлен в screens.css.
