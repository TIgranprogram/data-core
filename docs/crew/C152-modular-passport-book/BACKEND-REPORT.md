# C152 — немедленная защита modules

Статус: ✅ защита готова; полный перенос редактора C095 не выполнялся и C152 остаётся открытым.
✅ modules[] никогда не удаляются при issue; dims/photoId/qty и несовпавшие строки сохранены.
✅ Pure helper compositionPresentation: tree только точный полный multiset plain name+qty верхних BOM-модулей; rich/extra/различия — both.
✅ Draft GET/PDF едины; issue фиксирует readonly internal marker атомарно; old issued без marker сохраняет прежние оба блока.
✅ Явная правка modules issued создаёт новую редакцию с пересчитанным marker; предыдущие modules+marker сохранены в revisions.data.
Файлы: passport-composition-presentation.ts(+spec), passport-issue.ts(+spec), passport-pdf-v2-layout/types, product-passport.schema/service и ближайшие PDF/GET/revision tests.
Проверки: tsc PASS; eslint всех затронутых TS PASS; Jest 5 suites / 23 tests PASS (5,588 с).
Сценарии: exact/plain, qty/name/multiplicity mismatch, dims/photo/unknown extra, issue→PDF сохранность, draft GET без записи marker, old issued и revision history.
Нужно от координатора: frontend marker policy, общий fullunit, финальный образ/приёмка. QA stand/release_review уведомлены: ожидание modules=[] заменить preserved+marker.
Документы data-model/C148-report/карта обновлены; коммит: —.
