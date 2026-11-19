# C157 — проверяемый helper первой тройки

`tools/logs/c157-first3-import.mjs`: default/--plan только локальные файлы и SHA PDF, API0. Nodecheck0; планdata/first3-local-plan.json.

PlanHash `6ea9b0e0fa83c9d0402040bde3c88d05f1a1b00a7a70d4de6f8d18a2aa508e6b`. Состав24479/31960,14/17.09;7077/7455/17.09;63/102600/18.09;10строк,3оплаты,142015,14руб. №24334HOLD(пока отдельный разбор даты), №4816жёстко запрещён.

Rootreviewперед--apply. Approvaltemplate вdata/first3-apply-approval.TEMPLATE.json сFALSEфлагами; настоящий first3-apply-approval.json не создан агентом доступа. Нужны planHash/productionWriteApproved/releaseVerified/approvedAt≤час/три номера, expectedUiHash=expectedBackendCodeHash=b809fed4,expectedVersion951,releasedCommitf76489b9.

Передwrites повтор узкого first4readproof(ровно1deletedpage≤20,иначеSTOP), проверкаСИЮпоИНН,3supplierINN. Все обращения черезштатныйapi.shprod, никакогоdirectMongo/fetch. Только3нужныхsupplierCREATEеслинет, безVATglobal; детерминированныеrequestUID→group→PDF→header/lines→issue→paymentUID. ФотоoriginalFilenameиsizeBytes сверяютсясфайлом. Финансы/НДС/строки/кол-во/статья/компания проверяютсядоissue и передpaymentсCASversion.

Perdoc/perstepжурналUID/intentHash/payloadHash/PENDING→DONE. Любые4xx/409/неJSON/потеряответа→STOP_RECONCILE, blindretryзапрещён. Bankfacts/приёмка/receive/globalVATupdate не повторяются. Никаких writes до отдельного заданияroot. ПослеDONE нужны отдельные3узкиефинансовыеread-сверки по новымsupplierIDs+СИЮ/17–18.09:8/1/1allocations и31960,14/7455/102600.
