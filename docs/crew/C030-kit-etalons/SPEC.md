# C030 SPEC — эталоны kit для 5 экранов (designer, 2026-11-07)

Основа: baseline L3 (home 68, supplier-catalog 45, dicts 36, stock 32, salesorders 29 = 210 из 1372), код экранов и `screens.css` (td- 101 правило, sec- 50, dict- 40, pf- 29, cat- 24, mt- 22, ol- 19, ua- 15, sc- 12).
Принцип: новых эталонов 2 (`navList`, `miniChart`), остальное — варианты существующих. Эталон повторяет нынешний вид; токены и отступы переносятся из старых правил `screens.css` в `kit.css`, потом правила раздела удаляются.

## 1. Таблица решений

| Группа классов | Экран | Решение | Эталон и вызов | L3 уйдёт |
|--|--|--|--|--|
| `cat-tile cat-body cat-name cat-n cat-art cat-grid cat-landing cat-top` | stock, supplier-catalog | б (один на два экрана) | `card({ size:'S', art, title, meta, onClick })` + `tileGrid(...плитки)` + `landing({ head, body })` | ~20 |
| `sec-tile sec-stock sec-panel* sec-item sec-grid sec-chev sec-name sec-n sec-body` | stock | б | `card({ size:'S', art, title, meta, expand:{ title, action, body } })` — плитка раскрывает панель под собой | ~9 |
| `td-tiles td-seg td-spark td-zero td-line` | home | в (малый) | `miniChart({ type:'bar' или 'spark', parts или points })` в слот `graph` у `card S`; сами плитки — `card S` (есть) | ~6 |
| `go-tiles go-tile today-actions` | home | а | `card S` с `onClick`/`href` + `toolbar` | ~4 |
| `td-panel td-ph td-pb td-pb-r td-b- td-feed td-urgent td-head td-bellwrap td-scope td-pulse td-filterwrap td-cols td-weekfold td-fold-body` | home | б | `section({ title, count, open, fixed:true, tone, urgent? })` (fixed = всегда раскрыта, без стрелки); колонки — `layout.cols(...)`; «Показатели/Неделя» — обычный `section` | ~16 |
| `td-group td-gn td-rows td-more td-more-link td-unm` | home | б | `section({ title, count, body, more:{ limit, label, onMore } })` — первые `limit` строк + «Все (ещё N) →» | ~7 |
| `td-pass td-passports td-title td-sub hot td-q td-q-t td-qcard` | home | а | `row({ title, meta, tone:'danger'/'warn', onClick, below })` | ~9 |
| `td-chip zero td-filter` | home | б | `stat({ value, label, tone, onClick, active })` — кликабельная пилюля; фильтр — `toolbar` | ~4 |
| `td-days td-day td-dn td-dd td-ev td-pt k-` | home | б | `tabs({ items:[{key,label,sub,marks:[tone]}], layout:'days', value, onChange })` | ~7 |
| `hint` (home, dicts, sc, stock) | все | б (общий) | правило `.hint` и `.hint.warn/.ok` из `screens.css` в `kit/kit.css`; вызов `hint(text, tone?)` → `p.hint` | ~18 |
| `skel skel-card` | home | а | `busyBlock('…')` | ~3 |
| `dict-layout dict-nav dict-main dict-head dict-titles dict-tools dict-body` | dicts | а | `layout.split({ side: navList, main: (toolbar + h2 + hint + список), sideLabel })` | ~8 |
| `dict-link dict-group dict-group-toggle ls-group ls-h ls-list ls-opt ls-t ls-extra` | dicts, supplier-catalog | в (один на два экрана) | `navList({ groups:[{ title, fold?, items:[{ key, label, count?, href? }] }], value, onPick, label })` | ~14 |
| `dict-list dict-item clickable dict-name dict-desc dict-acts dict-lock dict-usage dict-cand dict-cand-list bulk-foot` | dicts | а | `row({ title, meta, side:[badge…], action, onClick, tag })`; замок — `badge('Встроено','dim')`; кандидаты — `row({ lead: чекбокс, tag:'label' })`; подвал — `actions` | ~12 |
| `pt-bar` | dicts | а | `toolbar(qualityFilter)` | 1 |
| `pf-strip pf-item swatch` | dicts | б | `photoStrip(list)` (вариант `gallery.js`: ряд миниатюр, клик — крупно); цвет — `badge(hex,'dim',{ dot: hex })` | ~4 |
| `sc-grid sc-card sc-price sc-price-v sc-f sc-nolink sc-stale sc-preview sc-shown sc-top combo-wrap` | supplier-catalog | б | `card({ size:'M', variant:'fields', price, body })` + `readonlyGroup`; устарела — `badge warn`; `sc-top` — `toolbar`; `sc-preview` — `section`; `combo-wrap` — `pick` | ~14 |
| `form-error ok` | supplier-catalog | а | `hint(text,'danger'/'ok')`, `failBlock` | ~5 |
| `so-grp so-grp-head so-grp-title so-pane so-pane-box so-add so-dots so-state` | salesorders | б | `card({ size:'L', head:{ title, badges, menu }, tabs:{ items, panes } })`; `+ Позиция` — `button S` в `toolbar`; `iconButton menu` для «⋯»; `so-state` — `busyBlock/failBlock` | ~10 |
| `ua-cb ua-list ua-row ua-main` | salesorders | а | `row({ lead: checkbox, tag:'label', title, meta })` | ~4 |
| `rdy-row ok` | salesorders | а | `row({ tone:'ok'/'warn', title })` | ~3 |
| `timeline tl-cont tl-line when pos in out` | salesorders, stock | а | `row({ lead: дата, title, side })`; продолжение группы = пустой `lead` | ~8 |
| `ol-mark ol-count mt-flag` | salesorders | а | `badge('…', tone)` | ~3 |
| `op-act` | salesorders | а | убрать класс-маркер: ссылка на узел в переменной | 1 |
| `pic-cell thumb st-cell tag tag-hang state info nowrap` | salesorders, stock | б (колонка table) | колонка `table` `{ pic:true }` / `{ nowrap:true }`; `tag` → `badge`; `state` → `empty`/`failBlock`; `thumb` → `posPic` | ~8 |

## 2. Опции новых вариантов и вид

Общее: только токены (`--surface`, `--border`, `--radius`, `--shadow`, `--s2..s4`, `--fs-*`, `--muted`, `--primary`, `--danger`); числа и hex мимо токенов — нельзя (L4). Клик — `k-hover`, `:focus-visible`, цель ≥ 44 px на телефоне (`pointer: coarse`).

1. **card S: `art`, `expand`** (плитка категории и зоны склада). `art` — узел 40×40 слева (`catArt`); заголовок `--fs-table` 600, мета `--muted`, часть меты «мало» — `--danger`. `tileGrid`: 3–4 колонки ≥1024, 2 на 390. `expand` — панель под плиткой на всю ширину сетки, `inert` в закрытом виде, `aria-expanded`; активная плитка с рамкой `--primary`. Витрина: S без art / с art / с expand открыт и закрыт.
2. **landing({ head, body })** — строка «Выберите … · всего N» (muted), кнопка справа, ниже тело. Витрина: вместе с плитками.
3. **section: `fixed`, `urgent`, `more`**. `fixed` — шапка h2 (`--fs-h3`, `--heading`) и число справа, без стрелки, рамка и тень как у карточки. `urgent` — полоса `--danger` слева (только при просроченных). `more` — «Все (ещё N) →» через `link`. Витрина: fixed, fixed urgent, с more.
4. **layout.cols(...блоки)** — 2 колонки ≥1100, 1 ниже (заменяет `td-cols/td-grid`).
5. **stat кликабельный: `onClick, tone, active`** — пилюля радиус 999; число `--fs-h2` 700 (`--danger` при >0, `--muted` при 0), подпись `--fs-sm`; активная — рамка `--primary`. Витрина: три пилюли, одна active, одна нулевая.
6. **tabs `layout:'days'`, `sub`, `marks`** — 7 равных клеток высотой 56 px (на телефоне ширина ≥44 px); сегодня — рамка `--primary`, выбранный — outline; `marks` — до 3 точек по тонам info/warn/danger/ok. Витрина: неделя с точками.
7. **miniChart** (в) — `bar`: полоса из долей по тонам, высота 6 px, `aria-hidden`; `spark`: SVG-линия `--primary` с нулевой осью `--border`. Витрина: оба внутри `card S`.
8. **navList** (в) — колонка в `panel`: заголовок группы (`--fs-sm`, `--muted`), при `fold` — кнопка со стрелкой и `aria-expanded`; пункт — подпись слева, число справа (`tabular-nums`), активный — фон `--surface-2` и полоса `--primary`; на телефоне — под кнопкой `layout.split`. Витрина: две группы, одна свёрнута, пункт-ссылка «→».
9. **photoStrip** — ряд квадратов 56 px, зазор `--s2`, клик — крупно (как `posPic`). **badge dot** — цветной кружок 12 px перед текстом. Витрина: 3 фото; 3 бейджа с цветом.
10. **card M `variant:'fields'`** — пары «метка — значение» в 2 колонки (на 390 — 1); цена слева `--fs-h2` 700, дата цены muted; внутри `readonlyGroup`, своих стилей нет.
11. **card L `head` + `tabs`** — шапка: `title`, `badges`, меню справа; под ней `tabs` и панель (в DOM только активная). Вид как у нынешней группы-договора.
12. **table: колонки `pic`, `nowrap`** — `pic` под `posPic` с шириной по размеру; `nowrap` — без переноса.
13. **hint(text, tone)** — `--fs-sm`, `--muted`; `warn/danger` — `--danger`, `ok` — `--ok`.

Витрина `#kit` (`sections/kit.js`): по разделу на пункты 1–13, подпись «где используется».

## 3. Порядок работ (L3 на единицу работы)

1. `hint` в `kit.css` + `table` `pic/nowrap` — самое дешёвое, ~26 L3 на всех 5 экранах.
2. `section` (fixed/urgent/more) + `stat` кликабельный + `tabs days` + `layout.cols` — почти вся главная (~45 из 68).
3. `card S art/expand` + `tileGrid` + `landing` — stock и supplier-catalog (~29).
4. `navList` — dicts и supplier-catalog (~14); затем `photoStrip`, `badge dot`.
5. `card L head+tabs`, `card M fields` — salesorders и карточка позиции каталога (~24).
6. `miniChart` — последним (~6), график остаётся как есть.
Остальное — переводы на существующие `row/badge/toolbar/button` без работы в kit.

## 4. Механический перевод (для рутины)

**home.js:** `td-panel/td-ph/td-pb` → `section({fixed:true})`; `td-group` → `section({more})`; `td-feed/td-rows` → `stack(...row)`; `td-pass`, `td-q` → `row({title,meta,tone,onClick})`; `td-chip` → `stat({onClick,active})`; `td-days/td-day` → `tabs({layout:'days'})`; `td-seg/td-spark` → `miniChart`; `go-tile` → `card S`; `td-cols` → `layout.cols`; `skel*` → `busyBlock`; `td-sub/td-title` → `row.meta/row.title`; `td-unm` → `link`; `hint` → `hint()`.
**stock.js:** `cat-tile…` → `card S art` в `tileGrid` внутри `landing`; `sec-tile…sec-item` → `card S expand`; `thumb` → `posPic`; `tag tag-hang` → `badge('висит N','warn')`; `st-cell` → колонка `nowrap`; `timeline/when/in/out/pos` → `row({lead,title,side})`; `state` → `empty`/`failBlock`.
**supplier-catalog.js:** `cat-*` как в stock; `ls-*` → `navList`; `sc-card/grid/f/price*` → `card M fields` + `readonlyGroup`; `sc-stale` → `badge warn`; `sc-nolink` → `link` + `button S`; `sc-top` → `toolbar`; `sc-preview` → `section`; `hint/form-error/ok` → `hint(text,tone)`; `combo-wrap` → `pick`.
**dicts.js:** `dict-layout/nav/main` → `layout.split` + `navList`; `dict-head/titles/tools` → `toolbar` + h2 + `hint()`; `dict-list/item/name/desc/acts/lock` → `row`; `dict-cand*` + `bulk-foot` → `section` + `row lead=checkbox` + `actions`; `pt-bar` → `toolbar`; `pf-*` → `photoStrip`; `swatch` → `badge dot`; `tag` → `badge`.
**salesorders.js:** `so-grp/head/title/pane/pane-box` → `card L head+tabs`; `so-add` → `button S` в `toolbar`; `so-dots` → `iconButton menu`; `ua-*` → `row lead=checkbox tag=label`; `rdy-row` → `row tone`; `timeline/tl-*/when` → `row lead`; `ol-mark/ol-count/mt-flag` → `badge`; `op-act` → ссылка в переменной; `pic-cell` → колонка `pic`; `so-state` → `busyBlock/failBlock`.

Не трогать: `money*`, `kp*`, `offers*`, `docs/QUESTIONS.md`. После каждого эталона: `design-lint` (вниз, новых 0), проверка синтаксиса модуля, витрина `#kit`, снимки 390/1024/1920 — приёмка designer.
