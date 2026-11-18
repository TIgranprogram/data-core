# C151 — backend

Статус: ✅ готово, runtime-код заморожен для общего релиза.
Сделано ✅ TZ §3: draft миниатюра использует live productphotos purpose=passport/kind=overview; issued/annulled остаются собственным снимком.
Сделано ✅ без live overview — fallback на собственный images; витринные и удалённые связи не участвуют; images[] не изменяется.
Файлы: backend/src/modules/product-passport/passport-queries.ts, passport-query-thumbs.spec.ts.
Проверки: tsc PASS; eslint двух файлов PASS; целевой Jest 3 suites / 9 tests PASS (4,99 с).
Число запросов: раньше 2 (только own), теперь для страницы с draft максимум 3 (один batch productphotos + два photos), N+1 нет. Тест на 23 строки подтверждает 1+2 запроса; повторные product/photo id исключены.
Проверены: draft old→live NEW; issued OLD; draft без live→OLD; showcase/deleted исключены; исходный images[] неизменён.
Прод-факт: 3218 issued №613 с собственным снимком, у изделия три passport-связи; какой PNG был новым, эти данные не доказывают. Аудит не выдаётся за подтверждение содержимого PNG.
Нужно от координатора: общий fullunit, final stand refresh и визуальная приёмка с PWA/VB изменениями других исполнителей. API-пути/схемы/исторические снимки без изменения.
Карта backend обновлена; коммит: — (не выполнялся).
