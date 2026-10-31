# ТЗ: Пошаговый мастер заполнения паспорта (PASSPORT-WIZARD)

**Класс:** M · **Агент:** datacore-frontend · **Не коммитить**

## Цель

В карточке паспорта-черновика показать наглядный пошаговый мастер (wizard): полоса шагов → для каждого незаполненного шага — компактная встроенная мини-форма → кнопка «Сохранить и далее» → переход к следующему шагу → в конце «Выпустить».

Пользователь не уходит с карточки. Каждый шаг сохраняется отдельным PATCH-запросом.

## Шаги мастера

| # | Ключ | Название | Заполнен если |
|---|---|---|---|
| 1 | `product` | Изделие | `r.productId` не пуст |
| 2 | `category` | Категория | `r.passportCategory` не пуст |
| 3 | `params` | Размеры и вес | `r.height` и `r.length` и `r.width` не пусты |
| 4 | `materials` | Состав и материалы | `r.materialIds?.length > 0` или `r.materials` не пуст |
| 5 | `photos` | Фотографии | хотя бы один вид в `r.images` есть (overview или любой) |
| 6 | `bom` | Комплектность | `r.bom?.length > 0` (опционально — шаг можно пропустить) |
| 7 | `issue` | Выпуск | кнопка «Выпустить» (финальный шаг) |

## Файлы

### НОВЫЙ: `backend/pwa/sections/passports/passport-wizard.js`

Экспортирует одну функцию: `passportWizard(r, ctx)` → DOM-элемент.

Структура компонента:

```
div.pw-wizard
  div.pw-steps          ← полоса шагов (горизонтально, скролл на мобиле)
    button.pw-step[data-done|data-active]  ← для каждого шага
  div.pw-body           ← тело активного шага
    div.pw-step-form    ← мини-форма шага
    div.pw-actions      ← [Пропустить?] [Сохранить →]
```

**Полоса шагов:** нумерованные кнопки. ✓ зелёные (done), текущий — выделен (active), будущие — серые. Клик — переключает активный шаг.

**Мини-форма каждого шага** (только нужные поля, без лишнего):

- **Изделие (1):** текстовое поле поиска по `/showcase` (suggest) → выбрал → `PATCH /passports/:id { productId }`. Если уже заполнено — показать название изделия и кнопку «Изменить».
- **Категория (2):** сегмент из `V2_CATS` (импорт из `./form.js`), под ним — если категория выбрана — `funnelBox({ value: r.textChoices, category })` (импорт из `../../ui/funnel.js`). `PATCH /passports/:id { passportCategory, textChoices }`.
- **Размеры и вес (3):** 4 числовых поля в ряд: Высота (мм), Длина (мм), Ширина (мм), Вес (кг). `PATCH /passports/:id { height, length, width, weight }`.
- **Состав (4):** `tagPick` для `elements` (элементы, `/dicts/passportElements`) и `tagPick` для `materialIds` (`/dicts/passportMaterials`). `PATCH /passports/:id { elements, materialIds }`.
- **Фотографии (5):** список `kinds(r)` из `./common.js` — только обязательные (`requiredImages`) + overview. Для каждого — мини-зона `photoDrop` из `../../ui/photos.js` (как в `imagesBlock`). `PATCH /passports/:id { images }`.
- **Комплектность (6):** `rowsTable({ columns: BOM_COLS, rows: r.bom || [], ... })` (импорт из `../../ui/rows-table.js`). Внизу — «Пропустить» (без сохранения, переход к шагу 7). `PATCH /passports/:id { bom }`.
- **Выпуск (7):** показать `checkBlock(r)` (импорт из `./card-blocks.js`); если `!r.missing?.length` — большая кнопка «✓ Выпустить» → `issueAction(r, ctx)` (импорт из `./dialogs.js`). Если есть missing — список с кнопками «→ заполнить» (переключение на нужный шаг).

**Сохранение:** кнопка «Сохранить →» делает PATCH, ловит ошибки через `toastError`, после успеха вызывает `ctx.setRow(await api('/passports/:id'))` и переходит к следующему незаполненному шагу.

### ИЗМЕНИТЬ: `backend/pwa/sections/passports.js`

В `card.extra` заменить логику для черновиков:

```js
// было:
extra: (r, ctx) => h('div', null,
  r.passportCategory ? checkBlock(r) : ...,
  imagesBlock(r, ctx), bomBlock(r),
  r.passportCategory ? previewBlock(r, ctx) : null),

// стало:
extra: (r, ctx) => {
  const draft = statusOf(r) === 'draft';
  return h('div', null,
    draft && canEdit() ? passportWizard(r, ctx) : null,
    !draft || !canEdit() ? (r.passportCategory ? checkBlock(r) : null) : null,
    imagesBlock(r, ctx), bomBlock(r),
    r.passportCategory ? previewBlock(r, ctx) : null);
};
```

Добавить импорт: `import { passportWizard } from './passports/passport-wizard.js';`

### ИЗМЕНИТЬ: `backend/pwa/ui/screens.css`

Добавить стили мастера в конец файла:

```css
/* === Мастер заполнения паспорта === */
.pw-wizard { margin-bottom: var(--s4); }

.pw-steps { display: flex; gap: var(--s1); overflow-x: auto; padding-bottom: var(--s1); margin-bottom: var(--s3); }
.pw-step { display: flex; flex-direction: column; align-items: center; gap: 2px;
  min-width: 72px; padding: var(--s1) var(--s2); border-radius: var(--radius);
  border: 1px solid var(--border); background: var(--surface-2);
  cursor: pointer; font-size: .75em; color: var(--muted); }
.pw-step[data-done] { border-color: var(--ok, #2a7); color: var(--ok, #2a7); }
.pw-step[data-active] { border-color: var(--accent); background: var(--accent-subtle, var(--surface-3)); color: var(--fg); font-weight: 600; }
.pw-step-num { font-size: 1.2em; font-weight: 700; }
.pw-step[data-done] .pw-step-num::after { content: ' ✓'; }

.pw-body { padding: var(--s3); border: 1px solid var(--accent); border-radius: var(--radius); background: var(--surface-2); }
.pw-step-title { font-size: 1.05em; font-weight: 600; margin-bottom: var(--s3); }
.pw-actions { display: flex; gap: var(--s2); margin-top: var(--s3); justify-content: flex-end; }
.pw-fields { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s2); }
@media (max-width: 600px) { .pw-fields { grid-template-columns: 1fr; } }
```

## Ограничения

- Читать только: `passports.js`, `passports/form.js`, `passports/card-blocks.js`, `passports/common.js`, `passports/dialogs.js`, `ui/funnel.js`, `ui/photos.js`, `ui/tag-pick.js`, `ui/rows-table.js`, `ui/toast.js`, `core/api.js`, `core/dom.js`
- Только создать `passport-wizard.js` + маленькая правка `passports.js` (card.extra и импорт) + стили в `screens.css`
- Не трогать логику формы (`passports/form.js`), `funnel.js`, другие секции
- Проверка синтаксиса: `node --input-type=module --check < backend/pwa/sections/passports/passport-wizard.js`

## Формат отчёта

```
Создано: passport-wizard.js
Изменено: passports.js (card.extra + импорт), screens.css
Шаги: 1-Изделие, 2-Категория, 3-Размеры, 4-Состав, 5-Фото, 6-Комплектность, 7-Выпуск
Синтаксис: OK
```
