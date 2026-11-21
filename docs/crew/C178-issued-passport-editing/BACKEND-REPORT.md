# C178 — backend редактирования выданного снимка
Статус: backend SOURCE FREEZE; адресный realMongo PASS, общий full/review/выпуск у координатора.
- ✅ snapshot field/item создают редакцию с прежними номером/status и полной старой печатной/текстовой проекцией без рекурсивной revisions.
- ✅ Один saveCurrent CAS по status/updatedAt/textSnapshot плюс revision; no-op до editedAt не сохраняет документ; annulled readonly.
- ✅ Frozen printSnapshot/стиль/фирма/схемы не перечитываются; реальный PDF берёт новый textSnapshot. Ordinarynameupdate не переделан.
- ✅ Issuedshortdescription разрешён локально и сохраняется как own simpleDescription экземпляра, чтобы будущая CADпересборка его учитывала; draftshort остаётся в шаблоне.
- ✅ CurrentUser опционально передаётся в историю; privilegednumbers/ролипромоушена не изменены. Promote меняет только источник.
- Файлы: passport-snapshot-revision.ts/spec; product-passport.service.ts:746/756/775; product-passport.controller.ts:snapshot-field/item; c178-issued-passport-editing.e2e-spec.ts.
- Проверки: tsc/eslint0; product-passport78suites/807testsPASS. Strict realMongo e2e6/6/0skipPASS: issue/name/PDF/oldprojection/field/item/no-op/CAS/annulled/roles/numbers/promote; QA13:29.
- Производственные данные не читались и не менялись; коммитов/выкладки не выполнял. Карта обновлена.
