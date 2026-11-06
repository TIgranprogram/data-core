# CL-C отчёт, список C
Готово (без коммитов). Изменены: passports/{card-blocks,numbers-strip,passport-wizard,product-block,dialogs,materials,product-types}.js, passport-tree.js, products/card-blocks.js.
Заменено: кнопки -> button()/iconButton(), select -> select(), toast(e.message) -> toastError(e), пустое состояние дерева -> empty().
grep -c "h('button'|h('select'|h('table'" по списку C: до 7 файлов-кнопок = 7+2+1+5+7+6+1+1(wire-form)+7(tree)+2(landing)=39 и 3 select; после 6 (wire-form 1, tree 1 pt-item, dialogs 1 pf-opt, numbers-strip 1 pn-num, wizard 1 pw-step, landing 2), select 0, table 0.
Остаток (нет в kit, экран оставлен): pf-opt (плитки выбора режима), pn-num (копируемое число), pw-step (шаги мастера), pt-item (строка дерева), cat-tile/sec-tile (плитки продукции), tag-чипы (wire-form, VARS), pf-del (крестик на картинке); landing.js:52 empty со вложенной кнопкой.
Мелочь: в passport-wizard убран inline style у «Выпустить» (button() стиля не принимает).
Проверки: --check каждого файла ок; design-lint по моим файлам 0 (общий новый: dicts.js L8, список A, не мой); dc check: импорты ок; pwa/sections *.test.mjs 37/37.
