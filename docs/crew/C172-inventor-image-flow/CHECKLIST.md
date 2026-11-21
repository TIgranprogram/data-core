# C172 — критерии QA
✅ Единая цепочка: серверные GET/POST и iLogic совпадают по именам contextToken/images/confirmed; архитектура в ARCHITECTURE.md.
✅ Повторная отправка: три разных вида, числа и dedup по содержимому; anchor/concrete проверены реальным PDF.
✅ Границы: annulled/готовый PDF/closed/attachment/mismatch не меняются; предупреждения явные.
✅ История: старые photoId остаются живы, прежние изображения воспроизводятся реальным PDF восстановленной data.
✅ Частичный сбой/CAS/гонки attach и create: нет успешного неполного результата; тест проверяет конечные данные.
✅ Ответ: applied/unchanged/issued/skipped/warnings, strict DTO и RBAC проверены.
✅ Итоговый targeted e2e: 1 suite/20 tests PASS, 0 skip, exit0, 13.031с; ESLint PASS. ➖ Full проекта, реальный Inventor и desktop принимает координатор.
Доказательства: QA-REPORT.md и QA-E2E-*.json/.log; исходные FAIL оставлены для аудита.

✅ Cleanup-fix: отдельный scoped тест 1/1 PASS, 20 filtered,14.197с; все6 прежних файлов защищены,6 DELETE409, история intact (QA-E2E-CLEANUP.json).
