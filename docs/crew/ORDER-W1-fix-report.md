# ORDER-W1 fix — design-lint «новых 0»
- R2: ui/target-picker.js -> ui/kit/target-picker.js (git mv), импорты в 6 разделах, экспорт в kit/index.js, data-k=targetPicker, DESIGN §4, блок #kit.
- L2: новый ui/kit/qty-input.js (qtyInput: поле + «+1», data-k), экспорт, DESIGN §4, витрина; stock-issue-card.js использует его.
- L8: salesorders.js и admin.js возвращены к baseline (zip-действие вынесено в order-attachments-zip.js как orderZipAction; склейка импортов/строк).
- Проверки: syntax, import-check (0 ошибок), preload, design-lint 0, pwa-guards зелёный.
- Риск: файлы рабочей копии CRLF; новые kit/qty-input.js, stock-issue-card.js — LF (L3 по CRLF-строкам не срабатывает, не конвертировать kit.js в LF).
- Правки дизайнера: stock-issue.js «×» -> kit.iconButton (aria «Убрать из списка»); подсказка экрана заменена; kit.css: `.k-actions input` 6-8em, min-height 44px (coarse/<=720); order-attachments-zip.js: info через sideNote, 403 + «Обратитесь к администратору». Проверки те же: lint 0, guards 219/219.
