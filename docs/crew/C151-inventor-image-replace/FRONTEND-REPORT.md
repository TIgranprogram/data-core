Статус: frontend реализован; локальный smoke PASS; визуальная/API-приёмка передана координатору.
✅ Контракт1: product bookFor всегда draftOnly; ищет status=draft, при отсутствии использует C149 createBookDraft с выбором фирмы. Обычный вход карточки/menu сохраняет прежний выбор.
✅ Alias safety_zone→safety через common.kindOf покрыт заменой и dedup; регрессия PASS. Контракт2: обычная загрузка/вставка заменяет все собственные рисунки выбранного вида; прочие виды/подписи сохраняются. «Добавить ещё» — отдельное явное действие.
✅ Наследуемые и readonly не предлагают upload; свежий inherited guard перед PATCH блокирует запись устаревшей зоны. Физические файлы не удаляются.
✅ Issued ручная замена проходит существующий PATCH /passports/:id, сохраняя серверную историю; скрытого обновления issued из изделия нет.
✅ Контракт4: правило сохраняет attach3/targeteddelete, затем VerifyReadSlots подтверждает ровно3 новых linkId и1нацелевойkind до успеха; сообщение объясняет draft и прежний issued.
Файлы: open-book.js:13–30; book-entry.js:17; book-images.js:22,41–60; passport-images.iLogicVb:387,585,614; book-entry.test.mjs и новый book-images.test.mjs.
Проверки:27/27 node tests PASS (два PNG, очередь, append отдельно, другие виды, ошибка PATCH, inherited/readonly, draftOnly и C149-фирмы).
Smoke: ES syntax3/3; imports346/0; pwa-guards341/341; design-lint новых0.
➖ Не выполнял Inventor/его VB-компиляцию; защита порядка VerifyReadSlots проверена исходником, реальный API-протокол и UI обеих тем проверяют access/дизайнер.
Нужно от координатора: пульт обновления локального правила, карта сайта/справка, общая приёмка, коммит/push/выпуск. Коммита и деплоя нет.
Карта frontend обновлена; C148 и чужие изменения не откатывались.
