# C239 — независимая проверка дельты рисунков

Вердикт после адресной повторной проверки: **PASS, можно** для C239. Обе находки ниже закрыты. Проверены новые images.mjs/extract-images.py, экспорт index, точные добавления pult document-intake/server/UI и image-preview; параллельные C237/238 не читались. Код и прод не изменялись.

## Первоначальные находки — закрыты

**P1 — N+1 при поиске договора, `tools/document-intake/images.mjs:61–77`.** Реальный список salesorders исключает legal; contractFor перечитывает каждую карточку, до10000штук, а prepare повторяется при send. Независимый обезличенный repro с100заголовками безlegal дал **101GETдеталей/105APIзапросов на один prepare**. При условной задержке1с это около100с только на поиск; это экстраполяция, не живой замер. Существующий fixture возвращает legal прямо в списке и скрывает стоимость. Минимальное исправление без backend: подтверждённый targetcontractId/адресный выбор передprepare, одинGETконкретного договора и проверка его sourceSHA; неизвестный договор требует выбора/адресного поиска, не глобального обхода всех деталей. Добавить регрессию числаGETна списке безlegal.

**P2 — размеры inline изображений проверяются после вычисления digest, `extract-images.py:21–32`.** get_images(full=True) покрывает только ресурсы; inline изображение не попадает в этот precheck, но get_image_info(xrefs=True) вычисляет digest с декодированием до проверки width/height/xref настр41. Независимый малый PDF с inline3000×1 дал resource_images=0 и get_image_info→width3000,xref0: заявленный predecode-limit обходится, хотя поздний результат отклоняется. До xrefs=True получить metadata безhashes/xrefs и отклонить oversized/неподдерживаемыеinline; добавить bounded fixture этого случая. OOM не воспроизводился и не заявляется.

## Что подтверждено

- `node --test tools/document-intake/images.test.mjs`: **13/13PASS**; `node --test pult/test/document-intake-images.test.mjs`: **3/3PASS**. Полный193тестовый прогон здесь не повторялся: это отдельная проверка QA.
- owner/target/sourceSHA/draftversion/legalversion/parent/sourceLine входят в сверку доотправки; после attach перечитываются родитель/источник/архив и прежниефото. Каталог,главноефото и исходныеPDF не меняются. Известное ограничение single-writer и отсутствие атомарного expectedParent у API сохраняется, глобальная exactly-once не обещается.
- prepare безPOST; confirmation15мин и повторная подготовка proof; assets ограничены PNG/JPEG/размером/сигнатурой/SHA, preview только безопасный data:image/base64 через img.src/textContent. Произвольные пути не поступают с UI; оригинал и store проверяются существующими findReview/openRoot, скачивание API ограничивает uploads данного контура.
- recovery фильтрует original против thumb/medium/full, сверяет имя/байты; uploadStarted сохраняется доPOST, неизвестный upload безнайденногоoriginal не повторяется; ID сохраняется доattach, addToSetповтор не дублируетсвязь. AUTH не маскируется, lock/busy/restart/revision/session-token guards сохранены и адресно проверены.
- SKU суффиксы/неоднозначные изображения отклоняются, mapping опирается на геометрию/уникальныйкод, не порядок; на будущее новый макет требует отдельной сверки. Реальный source/backfill8files9links взят из отчётов задания, повторные записи не выполнялись.

**Инструктивная дельта `docs/roles/qa.md` C237 — одобрена.** Урок требует stdout/stderr, отдельных JSON коротких e2eпроцессов и сверки полного набора suites послеOOM; несовместимуюсреду проверяет в новой изолированнойMongoDB, не ослабляя guards. Это уточнение доказательств полногоохвата, не разрешение пропускать проверки.

## Адресная повторная приёмка P1/P2

- **P1 закрыт:** `contractFor` читает только выбранный contractId и проверяет фактический sourceSHA в legal. Без ID/локальной проверенной привязки prepare возвращает selectionRequired без запросов списка/карточек. Поиск `searchImageContracts` — один GET заголовков по search с limit20/page1, без GET деталей каждого результата; UI требует явного выбора. После начала upload смена связанного договора блокируется, send использует ID подтверждённого plan.
- **P2 закрыт:** сначала `get_image_info(hashes=False,xrefs=False)` для всех вхождений, включая inline; проверяются dimensions≤2560, число≤200 и decoded estimate≤32MiB/страница. Только после этого выполняется xrefs/digest/extract. Инструментированный малый fixture inline3000×1 доказывает отказ до digest/extract_image.
- Независимый повтор `node --test tools/document-intake/images.test.mjs pult/test/document-intake-images.test.mjs` — **20/20 PASS**, exit0, ~0,79с; включает ограничение числа запросов и inline predecode.
- Дополнительный независимый вызов `createDocumentIntake` с обезличенным engine: `imagescontracts` без входа→401, stale revision→409, короткий search→400, занятый action→409, корректный→200 с текущим tokenProvider. **PASS**, secrets/прод не использовались. HTTP-тест проверил imagescontracts в gate опасной команды; restartAt проверен по тому же условию server.mjs:447.
- Общий повтор QA и визуальная приёмка остаются отдельными доказательствами, результаты прежних193/194 не подменяют новую дельту. За пределами двух исправлений и нового search-action широкого повторного аудита не проводилось. Принятые ограничения single-writer/неизвестного upload и прежняя положительная часть отчёта сохраняются.
