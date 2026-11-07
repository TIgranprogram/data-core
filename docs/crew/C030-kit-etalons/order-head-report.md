# Шапка панели заказа — отчёт (frontend, 2026-11-07, не закоммичено)
Статус: готово. Пункты ТЗ 1–5 ✅ (этапы — полоса 8px + строка текущего, title на сегментах, кнопки сохранены; числа — значки в строке заголовка; телефон 390 — значки под номером, полоса на всю ширину).
kit: `backend/pwa/ui/kit/stage-bar.js` (stageBar, headStats) · `stage-bar.css` · `kit/index.js` (1 строка экспорта) · `kit/card.js` (card.headStats / card.headStrip в шапке) · `index.html`, `sw.js` (подключение css) · витрина `sections/kit.js` (блок) · `docs/DESIGN.md` §4 (строка).
экраны: `sections/order-head.js` (новый: воронка заказа + orderHead) · `sections/salesorders.js` (`...orderHead(openStep)`, плитки stats убраны) · `ui/stage-bar.js` (реэкспорт) · `ui/panels.css` (старые .stg удалены, осталась плашка «Отменён»).
Проверки: --check всех файлов ok; design-lint: новых 0 по моим (остались чужие L6 unit/chain); pwa-guards падает только из-за них; снимки 1440 и 390 смотрел (текущий этап — тёплый --warn, пройденные — зелёные).
Другие панели с плитками .stats (не переводились): stock, passports, partners, orders, договор в salesorders (стр. ~629).
Контракт: панель договора по-прежнему зовёт stageBar(r,{onStep}) (прежняя сигнатура).
