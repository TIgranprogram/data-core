# UI-KIT-INVENTORY — что есть сейчас и что станет эталоном (K-0.1, 2026-10-31)

Источники: `node backend/scripts/ui-inventory.mjs` (полный перечень — `docs/audit/ui-inventory.md`) и grep по `backend/pwa`. Цифры — по коду, снимков не делали. Новых видов не изобретаем: эталон — лучший из существующих.

## 1–2. Семейства: что есть сейчас, какой эталон

| Семейство | Реализации сейчас (JS, CSS) | Потребители | Видов | ЭТАЛОН |
|--|--|--|--|--|
| card | `.tcard` (base.css:135, доска); `.db-order` (panels.css:73, заказ с позициями, полоса цвета 6px); `.tile` (base.css:151, плитки); `.td-card` (screens.css, «Мои задачи»); `.cards` (list.css:24, мобильный вид списка). `ui/card.js` — не карточка, а правая панель сущности | tcard: board.js, design-board.js; tile: home, money, products, supplier-catalog, list; db-order: board.js, design-board.js | 5 | см. S/M/L ниже |
| board | `ui/board.js` (229 строк; work, list, design); `ui/design-board.js` (593; design, design-order). Общий CSS `.board/.col` (base.css:127); второй вариант плотности — `.tcard.compact`, `.board-pics`, `.col-sum/.col-hint/.col-tools` (screens.css:1177–1420) | work, list, design, design-order | 2 (+compact, +pics) | `board.js` + `.board/.col/.tcard` (DnD через drag.js). `design-board.js` приводить к нему, а не наоборот |
| table | `ui/list.js` (624; pager, поиск, экспорт, `.table-wrap`, `.cards` на телефоне); `ui/rows-table.js` (87; табличный ввод и импорт xlsx); `.db-tbody` (panels.css:123) | list: docs, money и справочники; rows-table: chat, fill, invoice, passports/* | 3 | `list.js` (единственный с pager и телефонным видом). rows-table — вариант «ввод» |
| panel | `ui/card.js` openCard (правая панель сущности); `side-form.js`; `form.js`; `panels.css` (530 строк) | почти все разделы | 1 | `card.js` + `side-form.js` (DESIGN §6: ввод только в панели) |
| filter | `cat-chips.js`; `facet-filter.js`; `funnel.js`; `step-funnel.js`; `.chips/.chip` (list.css:5); `searchbox.js` | cat-chips: dicts, passport-tree; facet: stock, stock-ops; funnel: docs, products; step-funnel: passports, products, requests, supplier-catalog | 4 | chips = `.chips/.chip` (подчёркивание, 44px); facets = `facet-filter.js`; funnel = `step-funnel.js` (больше потребителей). `funnel.js`, `cat-chips.js` становятся обёртками |
| pick | `select.js` (12 потребителей); `combo.js` (15 разделов); `tag-pick.js` (4); `suggest.js` (form.js); `target-picker.js`; `composition-suggest.js` | см. столбец слева | 4+ | single = `select.js`; combo = `combo.js` (самый частый для справочников); tags = `tag-pick.js`; `suggest.js` уходит под combo |
| badge/status | `badges.js` (`badge(map,key)`, `.badge` с точкой, 15 файлов); `app-badge.js`; `.chip-sec`; `.tag`; `stage-bar.js` (воронка заказа) | orders, requests, stock, design, invoices… | 1 + 3 частных | `badges.js` + `.badge` (CANON §2 уже требует). `.tag`, `.chip-sec` — вариант «метка» |
| button | `.btn` (base.css:89) + `-primary -gold -danger -ghost -sm -icon`; `.link-btn` (17 раз) | везде | 7 модификаторов | primary / secondary (`.btn`) / ghost / danger, размеры M (36px) и S (`btn-sm` 30px; на 390px ≥ 44px). Самый частый `btn btn-sm` (70). `btn-gold` свести к primary, `link-btn` к ghost S |
| empty | `empty.js` `.state` (используют лишь 2 файла через функцию; ещё ~10 разделов лепят `.state` руками); `.db-empty/.db-hint` (panels.css:72); `failBlock` (busy.js) | design-requests, dicts, passport-*, products, staff, supplier-catalog, work | 3 | `empty.js emptyState({title,hint,action})` |
| tabs | `.chips/.chip` (requests-tabs.js, invoices-tab.js); `.db-tabs` (скрыты); `side-link` (меню) | requests, invoices, help | 2 | `.chips/.chip` |
| stat | `.stats/.stat` (list.css:84, только в панели card.js); `.sum-` (13 строк); `.col-sum` | card.js, money, home | 3 | `.stats/.stat` (число 22px, подпись sm) |
| toolbar | `.toolbar` (list.css:3) в board.js и list.js; `.board-bar` (массовое действие) | board, list | 2 | `.toolbar` |
| dialog | `dialog.js` (modal, confirmDlg, 31 строка); `popup.js`; `pop-menu.js`; `confirm-password.js` | 37 разделов | 1 + меню | `dialog.js` (подтверждение или 1–3 поля, DESIGN §6) |
| toast | `toast.js` + `notice-card.js` (один вид для всплывашки, колокольчика, failBlock); `bell.js` | почти все | 1 | уже единый: `notice-card.js` |
| layout | `.tiles`, `.board`, `.stats`, `.toolbar`, grid-классы в screens.css (`gt-`, `td-`, `hp-`…) | — | десятки | три: grid (`.tiles`), split (список + панель), stack. Остальное остаётся раскладкой раздела |
| timeline | `ui/gantt.js` (309; только work.js); `gt-` 50 строк; `month-` | work.js | 1 | `gantt.js` (особое семейство) |

### Размеры card (только из существующих)
- **S — строка/плитка** (список, склад, «Мои задачи»): `.tile` (base.css:151) для плиток склада и справочников; `.td-card` (строка 44px с точкой цвета) для задач. Свести к одному `.tile` с `tone` и иконкой категории.
- **M — карточка доски**: `.tcard` (base.css:135; padding 10/12, t-title / t-sub / t-meta / t-foot). `.compact` (миниатюра 40px, 1 строка) — это S на доске, не отдельный вид.
- **L — шапка сущности / заказ с позициями**: `.db-order` (panels.css:73, полоса цвета заказа `--oc`, раскрытие позиций) и шапка в `card.js`.

Почему так: `.tcard` и `board.js` — самый чистый CSS на токенах, один набор отступов. `design-board.js` тянет свои 593 строки и `db-*` стили.

## 3. Префиксы screens.css (1917 строк)
«Оформление» = строки с background / border / box-shadow / color / font / radius (уйдёт в kit). Остальное — раскладка.

| Префикс | Строк | Оформление | Что это, куда |
|--|--|--|--|
| td- | 126 | 68 | «Мои задачи» → card S |
| ops- | 63 | 30 | операции склада, вес → card S, table |
| gt- | 50 | 39 | Гант → timeline (почти всё оформление) |
| hp- | 40 | 25 | главная, помощь |
| pt- | 37 | 18 | паспорта (не трогать) |
| ff- | 37 | 18 | формы, заполнение |
| pg- | 34 | 23 | страницы, пейджер |
| wk- | 33 | 20 | «В работе» → board, card |
| dict- | 32 | 15 | справочники → table, filter |
| inv- / invl- | 30 / 28 | 12 / 10 | счета → table, badge |
| q- | 27 | 17 | очереди (matching, docs) |
| pp-, ms-, chat-, pf- | 27, 27, 27, 24 | 10, 14, 13, 15 | печать паспорта, материалы-спец, чат, профиль |
| sec-, combo-, st-, cat-, mt-, fill-, cv-, bell-, spec- | 22, 20, 18, 18, 16, 16, 16, 15, 14 | 8, 12, 4, 6, 5, 8, 10, 8, 3 | combo, bell, st — уже компоненты, переезжают в kit как есть |
| прочие (около 25 префиксов по 3–13 строк) | около 450 | около 45% | смесь |

Итог: около половины строк — оформление. Цель «меньше 400 строк» достижима только после card, board, table, filter. Крупнейшие выигрыши: td- (126), ops- (63), gt- (50), wk- (33).
Вне CSS: `style=` / `.style.` встречается в 22 файлах sections (правило R5).

## 4. Порядок миграции (по видимости)
1. Кнопки (`.btn`: gold и link-btn свести; размеры S/M) и меню/вкладки (`.chips`, `side-link`) — видны на каждом экране.
2. card S/M/L + badge + empty и витрина `#kit` (K-1.1).
3. Доски: «В работе», «Проектирование», «Заказы» — одна плотность (K-1.2). Затем склад, плитки S (K-1.3). «Мои задачи» (td-) — самый тяжёлый CSS.
4. filter (cat-chips, funnel → chips / step-funnel) и pick (suggest → combo) — K-2.
5. table (list.js, rows-table как вариант) и panel — K-3.
6. Последними: Гант, чат, паспорта (печать и мастер не трогать), админка.

Слепая зона: реальные размеры шрифтов и отступов карточек на 390/1024/1920 по коду не сравнить. Нужен снимок «до/после» (с разрешения пользователя).
