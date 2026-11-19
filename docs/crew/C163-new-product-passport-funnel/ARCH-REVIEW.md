Вердикт: можно (PASS архитектурного scope C163; P1 закрыт адресно). Выпуск зависит от общей QA/UI-приёмки координатора.
Проверено: showcase-photos/present/products fallback; template-patch CAS; productPatch; short compose; book-setup/choices/editor/template-edit; passport-tree/state.
🟢 Закрытие P1: backend/src/modules/product-passport/passport-from-product.ts:60–70 — категория вычислена до derived, MAF нормализован к BLG; parentId проверяется по живым productFacets своей категории, чужой/удалённый/битый родитель не даёт элементов.
🟢 Сохранность: :63 собственные непустые pd.elements приоритетны; :65–79 только чтение, facetValueIds не меняются. Регрессии отдельно проверяют TRN→BLG→MAF, чужой хвост, отсутствующего/удалённого/битого родителя и собственные elements.
Повторно проверены только productPatch и его spec: новые сценарные fixtures фильтруют dict/deletedAt/category/$in, 19/19 Jest PASS. SHA256 исходника 93DCB2BD087295F9DEC573BE6E296F418F0114B0C1238AF51F0747AF92B3FFC1 совпал с freeze.
🟡 P2/граница: passport-template-patch.ts:158–183 читает справочники до CAS; concurrent dictionary edit не защищён, как и прежние kind/parts/install. Нового воспроизводимого обхода выпуска не доказано; широкая переделка dictCRUD не требуется этим отчётом.
🟢 template-patch.ts:217–231 — один Mongo4.4 updateOne, root facetValueIds, null→REMOVE против [], CAS массива и categoryId/собственных kind/category; независимые defaults сливаются.
🟢 showcase-photos.ts:14–43 — пакетное чтение, собственный порядок и gallery отдельно, fallback URL через safeUploadPath; products.js:134 — показ не мутирует фото, принятие явное. short compose фильтрует technical sections до needJoints, safety/maintenance остаются.
🟢 passport-tree-state.js:5–30 учитывает условия при дублях и leaf applicability; фильтр не удаляет данные. book-setup.js:13–65 сохраняет чужие группы и CAS baseline; sideForm оставляет ввод при 409.
Автопроверки собственные: 4 suites / 63 Jest PASS; 14 node tests PASS; backend/scripts/audit-cycles.js:0 пар. Backend tsc/875 и общий full/e2e — отчёты координатора/QA, здесь не повторялись.
Не проверено: браузер, реальные данные/API, скорость <1с/<300мс, финансовый diff. Общий review-scope показывает исторический хвост 1520 файлов; --done не ставился, проверен только C163.
коммит: f76489b9 + рабочий diff; якоря C163 добавлены в docs/roles/maps/architect.md; карта обновлена.
