# C178 — матрица независимой QA
Статус: PREPARED; ни один пункт ниже ещё не принят.
| Сценарий | Доказательство | Ожидание |
|--|--|--|
| Issued: явное изменение названия | realMongo PATCH+GET, закрыть/открыть UI, настоящий PDF | Тот же id/номер/status,revision+1; старое имя/снимок вhistory, новое вPDF |
| Issued snapshot-field | realMongo API→GET→printSnapshot/PDF | Одна atomicредакция, прежний полный снимок сохранён; картинки/связи/талон/номер неизменны |
| Issued snapshot-item | тот же поток для вложенного текстового элемента | Новый локальный текст печатается; старая версия воспроизводима изhistory |
| Samevalue / отмена / open-close | APIповтор и действия браузера | Нет лишнейредакции/номера, нет записи при отмене |
| Параллельный CAS / отказ записи | управляемый barrier и настоящий Mongo4.4 | 409 либо корректная сериализация; нет частичного revision/historyloss |
| Promote-to-source | APIсверка экземпляра до/после | Изменение источника не переписывает снимок/редакцию экземпляра |
| Права / annulled / protected numbers | отрицательные APIзапросы | Чтение/привилегированные поля не обходятся, отказ без записи |
| Draft / issued entry / PDFattachment | node+browser2темы через паспорт заказа | Draftсохранил выпуск;issued не предлагает новый выпуск/вариант; собственныйPDF не обещает inlineредактор |
| Общий выпуск | один завершённый full после C178/C176/C177freeze | Unit/e2e/типы/lint/build/OpenAPI плюс sourceSHAдо-после; реальныеUIдоказательства отдельно |

QAконтур: own c172-qa-mongo Mongo4.4.30/rs0 127.0.0.1:27172; общая БДdatacore-test-c176-identification. НовыйC178e2eguard должен разрешать только этот согласованныйnamespace иloopback. Текущий37PASS/0FAIL прерван по новомуscope и не считается общимPASS. Рабочие данные не используются.

Адресный результат21.11: 6/6e2ePASS0skip на ownMongo4.4/общем namespace, raw tools/logs/c176-qa-2026-11-21T13-29-29-048Z. Покрыты все серверные строки матрицы: issuedfield/item+PDF/history, samevalue, реальныйCAS409,ordinaryname, promote, draft/annulled/roles/protectednumbers. Первый5/1FAIL был только пустойassets{} vs raw.toObject(minimize); persistedsnapshotexactassert уже проходил, после канонизации только пустыхassets весьостальнойprintcontext сравниваетсяточно. Общийfull/browserещёнеприняты.

Финальный серверный допуск21.11: C1786/6 и полный e2e777/777 PASS,12 T26 opt-in SKIP;3914unit PASS/types/lint/build0 на точно том же src/admin SHA. Общий src/test/admin1322 файла SHA c7d6e3ca…689b8e до/после совпал. Финальная PWA365guards/371imports PASS; настоящая UI-приёмка отдельно у координатора. Доказательства: ../C176-product-identification-queue/proofs/qa-2026-11-21T14-25-31-599Z/FINAL-EVIDENCE.json и PWA-EVIDENCE.json.
