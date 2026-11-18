# Компактный ввод в правой колонке книжки (C143)

Дата: 2026-11-18

## Зачем
При правке материалов ИИ и Inventor съедали место; карточки строк и отступы были крупные; «Сохранить» уезжал вниз.

## Что сделано
1. ИИ + Inventor вынесены в `.bk-side-tools`; при `.bk-side.is-editing` скрываются.
2. Все формы слота (`beginEdit` / `setSideWide(..., { editing: true })`) включают режим правки; `releaseSlot` и «К подсказкам» снимают.
3. Плотнее CSS: padding/gap панели, карточки строк, чипы, sticky-ряд «Сохранить» сверху.
4. Материалы в книжке: `preview: false` (текст уже на листе); подсказки-абзацы у форм убраны.
5. Ширина materials/состав: `min(400px, 24vw)` вместо 480/28vw.

## Файлы
- `backend/pwa/sections/passports/book-editor.js`
- `backend/pwa/sections/passports/book-side-edit.js`
- `backend/pwa/sections/passports/book-composition-funnel.js`
- `backend/pwa/sections/passports/book-focus.js`
- `backend/pwa/ui/kit/kit.css`

## Проверка
- `node --input-type=module --check` — ок
- стенд: обновить код (`stand-look --refresh`), открыть материалы — без блоков ИИ/Inventor, кнопки сверху, плотнее строки
