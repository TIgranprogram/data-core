# C178 — финальный прямой review источника названия
Вердикт: **PASS узкого diff, можно к отдельному QA full**. Базаa96e708d + текущийname-sourcepatch; рассмотрены ровно3runtimeфайла и адресные регрессии, код не менялся.
bindPresentation больше не возвращает income.title в name; проверки product/order/line/company/cancelled/selection не ослаблены. BoundGET/issue не перетирают настоящий manualname; приоритет Product.name применяется существующим fromProductDiff/diffPatch.
Обе автоматические orderbatchветви передают incomeId/контекст/фирму безtitle-as-name; optionalаргументtitle hostсохранён длясовместимости, позиционныеаргументы не сдвинуты. Автоматическое имя больше не маркируется manualText/instanceManualText.
Legacyявныйdto.name по-прежнему сохраняется веткой ownName; standaloneбезproductId остаётся ручным. Дляgeneratedpresentation1 отдельная осознаннаяправка черезPATCH/manualflags сохранена, старыеmanualflagsне мигрируются.
IssuedREAD/name-history/номера/creationScope/права/attachedPDF не переписаны. НовыйисточникнеобновляетстарыеissuedприGET; ихадреснаяправка20-26 — отдельный reviewedплан/штатнаяредакция, не частьэтогокода.
Просмотренытесты short/full create→draftGET→issue→PDF/freeze,manualdraftname+issuedhistory+403/oldPDF,обеorderbatchветви,standalone. Результатыкоординатора:818moduleunit,tsc/eslint0,targetedстарые6+новые6=12PASS; повторнонепрогонялись.
Граница: полныйпрогонновогосource/PDF20-26/productionrelease ведёткоординатор. C179монтаж/семьисправленийданных не рассматривались и не менялись этимreview.
