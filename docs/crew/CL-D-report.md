# CL-D — отчёт (2026-11-06)

Статус: готово (кроме td-pass/go-tile — см. остаток). Не закоммичено.

1. docs «По заказам»: пока грузится — `empty` «Загружаю…» (раньше пусто); сырой input поиска в docs-orders и docs-queue → `searchBox`. ✅
2. staff 390: виновник — `ul.st-list` (grid с авто-колонкой растягивался по nowrap-кнопкам) → `grid-template-columns: minmax(0,1fr)`, кнопки/select в строке сжимаются на ≤720. ✅ (screens.css 1426, 1444)
3. payroll: `a.btn` → `empty({action})`; money: `button.sum-item.attn` → `button({cls})`. ✅
4. home: `td-chip`, `td-day` → `button({cls, icon, label})`; `q-link` на ≤720 min 44px (токен `--tap`). aria-pressed у них потерян (kit его не поддерживает). ✅
5. «Сегодня»: заголовок «Срочно» красный только при непустом списке; три нулевые пилюли → «Всё спокойно»; Заявки: `.ls-grid > .list-side` фон `--surface` + рамка; чекбокс `.t-pick input` 44px на ≤720. ✅

Побочное (нужно для lint):
- `searchBox` перенесён `ui/searchbox.js` → `ui/kit/searchbox.js`, помечен `data-k="search"`, экспорт в `kit/index.js`, блок в витрине `#kit`, строка в DESIGN §4; импорты main.js/dicts.js/kit/filter.js/kit/list.js, `pwa-preload` пересобран.
- Новый токен `--tap: 44px` (tokens.css). Правки-оверрайды `.btn.td-chip/.td-day/.btn.sum-item` — в конце `kit/kit.css` (screens.css не вырос).
- dicts.js: две строки разбиты, чтобы L3 не принимал `size:'S'` за класс (lint).

Файлы: sections/home.js, money.js, payroll.js, docs-orders.js, docs-queue.js, dicts.js, kit.js; ui/kit/{searchbox,index,kit.css,filter,list}.js, ui/screens.css, ui/tokens.css, main.js, index.html, docs/DESIGN.md.

Проверки: `--input-type=module --check` всех изменённых — ок; design-lint новых 0 (всего 6252); `dc check` зелёный; `node --test sections/*.test.mjs` 37/37; jest pwa-guards 220/220.

Остаток/риски: `button.td-pass` и `button.go-tile` (запрос п.2 в GLM5-requests) не тронуты — нужен вариант row tile; `table.cal` не трогали. Снимки не снимал: проверить глазами `.btn.td-day` (высота 56) и `.btn.td-chip` на 390.
