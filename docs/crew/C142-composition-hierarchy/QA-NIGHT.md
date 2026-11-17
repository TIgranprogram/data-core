# QA-ночь C141/C142 — 18.11.2026

Статус: **SMOKE PARTIAL**. Код приложения не менялся. Node v26.13.0. Стенд и full не запускались.

## Команда → итог

| Команда | Итог |
|--|--|
| `node --test backend/pwa/sections/passports/book-etalon-gate.test.mjs` | **PASS** 4/4, exit 0, ~50 мс |
| `node --test` 13 соседних `backend/pwa/sections/passports/**/*.test.mjs` (без флага) | **FAIL** exit 1: 38 тестов PASS, 6 файлов не загрузились |
| те же 6 файлов с `--experimental-vm-modules` | **PASS** 33/33, exit 0, ~0,8 с |
| `Get-Content -Raw \| node --input-type=module --check` на 8 файлов ниже | **PASS** exit 0 у каждого. Контроль: мусорный stdin → SyntaxError, exit 1 |
| `backend/`: `npx tsc --noEmit` (повтор из `backend/`, 3219 файлов) | **PASS** exit 0, ~1,5 с. JS приложения tsc не видит |

Файлы `--check` (все exit 0): `passports/book-composition-funnel.js`, `passports/book-editor.js`, `passports/book-side-edit.js`, `passports/book-focus.js`, `sections/modules.js`, `sections/parts.js`, `sections/comp-editor.js`, `pwa/main.js`.

Шесть файлов без флага падают на `funnel/test-vm.mjs:3` и копиях импорта: `node:vm` не отдаёт `SourceTextModule` без `--experimental-vm-modules`. Это ловушка запуска на Node 26, не падение логики. С флагом зелёные: `fill/control.test.mjs`, `funnel/index-partial.test.mjs`, `funnel/new-product.test.mjs`, `funnel/pick-steps.test.mjs`, `product-block.test.mjs`, `product-block-create.test.mjs`.

С флагом суммарно по паспортам этой ночи: **75 PASS, 0 логических FAIL** (4 ворот + 38 без флага + 33 с флагом).

## Красные дыры

1. Воронка состава C142 поведением не доказана. В `backend/pwa/**/*.test.mjs` нет `book-composition-funnel` и `book-side-edit`. Зелёный `--check` не закрывает чек-лист A (дерево, шаги, сырьё, PUT, возврат из создания).
2. Глаза не смотрели. C142 A «выбор в паспорте» и C141 «картинки / выпущенный паспорт» — стенд не открывался.
3. C142 B–F в `CHECKLIST.md` всё ещё `[ ]`. Эта ночь их не закрывает. Full и `dc check` не гонялись (full — перед выкладкой).
4. `passports/modules.js` в список `--check` не входил. Проверен раздел `sections/modules.js`.

## Добивка дыры 1

Статус: **PASS** (3 кейса). Код `book-composition-funnel.js` не менялся. Браузер не нужен.

`node --test backend/pwa/sections/passports/book-composition-funnel.test.mjs` — **3/3, exit 0**, ~43 мс, без `--experimental-vm-modules`.

| Кейс | Итог |
|--|--|
| сырьё | `raw` нет в `KIND_LABEL`; шаг «Что добавить» — только `module` / `part` / `purchased`; `loadCatalog('raw')` → `[]`, API не зовётся |
| дети модуля | `moduleKids` зовёт `/modules/:id/composition` и собирает имя, количество, единицу |
| экспорт | в файле `export async function mountCompositionFunnel`; `book-side-edit.js` (`openCompositionInBook`) его вызывает; вызов возвращает `{ focus }` |

`loadCatalog` / `moduleKids` / `KIND_LABEL` не экспортированы. Тест гоняет тот же исходник в `vm.Script` с заглушкой `api`. `SourceTextModule` на Node 26 без флага не стартует — поэтому не он.

Дыра 1 закрыта только в этих трёх кейсах. Дерево на экране, PUT состава и возврат из создания — по-прежнему без теста. Глаза (дыра 2) не смотрели.
