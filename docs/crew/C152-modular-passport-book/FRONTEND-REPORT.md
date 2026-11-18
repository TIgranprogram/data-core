Статус: немедленная защита C152 реализована; полный modulesEditor остаётся открытой будущей задачей.
✅ Книжка показывает дерево compositionSheet и сохранённые modules[] одновременно, когда compositionPresentation !== 'tree'.
✅ Отдельный заголовок «Модули: сохранённое описание»; название, размеры и количество сохраняются видимыми.
✅ Только серверный marker tree подавляет повтор; старый issued без marker сохраняет legacy-описание.
Файлы: backend/pwa/sections/passports/book-blocks.js:131; book-composition-tree.test.mjs.
Проверки:12/12 совместных C151/C152 node tests PASS; ES syntax2/2; imports346/0; guards341/341; design-lint новых0.
➖ Фото модуля, редактирование name/dims/qty/photoId и modulesEditor не переносились: отдельный future checklist TZ. Данные modules[] этим исполнителем не менялись.
Нужны UI/API-приёмка с серверным marker, QA/дизайнер и выпуск координатором; имя/inline/C148 чужие изменения сохранены.
Карта frontend обновлена; коммита и деплоя нет. C152 целиком не закрыта.
