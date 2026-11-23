# C241 — исправление компиляции iLogic с .NET10

23.11.2026. Подтверждённый дефект ПС-06: окно выбора установки требует System.Private.Windows.Core.dll в явных ссылках компилятора Inventor2027. Исправление — одна AddReference в каноне; выбор, UI, геометрия, HTTP и данные не менялись.

Прежний Compile.vbproj проверял net8.0-windows и механически удалял AddReference. Он не проверял совместимость ссылок реального .NET10-хоста и не мог поймать этот дефект. Старый PASS не выдаётся за успешную компиляцию в iLogic.

Реальный полный исходник с прежней минимальной обёрткой скомпилирован vbc4.11 из SDK8.0.427, но со ссылками на установленные managed DLL Microsoft.NETCore.App10.0.0 и Microsoft.WindowsDesktop.App10.0.0 плюс установленный Inventor2027.Interop. Без System.Private.Windows.Core воспроизведены точно6BC30652: IPersist.Interface/IHandle на Using Form и AcceptButton/CancelButton. При добавлении этой единственной ссылки полный код даёт exit0,0errors/0warnings. Модель/COM/HTTP/ключи не запускались и не читались.

Доказательства: net10-compile/before.txt и after.txt; точные списки ссылок before.rsp/after.rsp. Временная обёртка %TEMP%/datacore-c241-net10-compile/Rule.vb; построена из канона удалением AddReference, добавлением Imports System.Windows.Forms и свойства ThisApplication As Inventor.Application. Это compile-only с целевыми runtime-библиотеками, не реальное выполнение правила в Inventor.

Проверки:7/7 протокольных Node,411/411pwa-guards,418imports/syntax0. Backend/API/БД не менялись; полный backend e2e заново не требуется по smoke-матрице. Перезапуск/смена библиотек Windows не нужны: библиотека10.0.0 уже установлена на ПК.

Пользователь должен повторно вставить канон либо добавить AddReference "System.Private.Windows.Core.dll" до Class ThisRule в уже вставленном правиле. Ссылка и отдельное актуальное действие — Пульт. Исправленный канон опубликован штатным fast-release v2.50, tag release-v2.50-2c5f508a, health200/smoke7/7. Публичный файл содержит новую строку; нормализация только CRLF→LF даёт точный GitblobSHA256 f8cb8f6421ad9b3fdb6bdbc97172fe0c8e659749670977008d6f350987bf89f8. Фактический RAW SHA отличается из-за884CRLF:33a636693fd3a40d985a67fc80251793c7baea1a023db276ab579f2c553105e2. Отдельный факт — NET10-PROD.md.