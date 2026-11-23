# C241 — исправление компиляции iLogic с .NET10

23.11.2026. Подтверждённый дефект ПС-06: окно выбора установки требует System.Private.Windows.Core.dll в явных ссылках компилятора Inventor2027. Исправление — одна AddReference в каноне; выбор, UI, геометрия, HTTP и данные не менялись.

Прежний Compile.vbproj проверял net8.0-windows и механически удалял AddReference. Он не проверял совместимость ссылок реального .NET10-хоста и не мог поймать этот дефект. Старый PASS не выдаётся за успешную компиляцию в iLogic.

Реальный полный исходник с прежней минимальной обёрткой скомпилирован vbc4.11 из SDK8.0.427, но со ссылками на установленные managed DLL Microsoft.NETCore.App10.0.0 и Microsoft.WindowsDesktop.App10.0.0 плюс установленный Inventor2027.Interop. Без System.Private.Windows.Core воспроизведены точно6BC30652: IPersist.Interface/IHandle на Using Form и AcceptButton/CancelButton. При добавлении этой единственной ссылки полный код даёт exit0,0errors/0warnings. Модель/COM/HTTP/ключи не запускались и не читались.

Доказательства: net10-compile/before.txt и after.txt; точные списки ссылок before.rsp/after.rsp. Временная обёртка %TEMP%/datacore-c241-net10-compile/Rule.vb; построена из канона удалением AddReference, добавлением Imports System.Windows.Forms и свойства ThisApplication As Inventor.Application. Это compile-only с целевыми runtime-библиотеками, не реальное выполнение правила в Inventor.

Проверки:7/7 протокольных Node,411/411pwa-guards,418imports/syntax0. Backend/API/БД не менялись; полный backend e2e заново не требуется по smoke-матрице. Перезапуск/смена библиотек Windows не нужны: библиотека10.0.0 уже установлена на ПК.

Пользователь должен повторно вставить канон либо добавить AddReference "System.Private.Windows.Core.dll" до Class ThisRule в уже вставленном правиле. Ссылка и отдельное актуальное действие — Пульт. Публикация исправленного канона ещё ожидает штатного fast-release.