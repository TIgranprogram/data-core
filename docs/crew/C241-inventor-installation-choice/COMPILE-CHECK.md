# C241 — безопасная проверка компиляции, 23.11.2026

**Дополнение по фактическому дефекту:** net8-проверка ниже недостаточна для .NET10-хоста. Шесть ошибок пользователя воспроизведены и устранены одной AddReference; целевой compile-only NET10 PASS — [NET10-FIX.md](NET10-FIX.md). Исторический результат ниже сохраняется со своими ограничениями.

PASS: полный канон `backend/pwa/ilogic/passport-images.iLogicVb` компилируется в библиотеку .NET 8 Windows с установленной `C:/Program Files/Autodesk/Inventor 2027/Bin/Autodesk.Inventor.Interop.dll`. Ошибок 0, предупреждений 0. Модель, Inventor COM и сеть не запускаются, ключи не читаются.

Временный проект: `%TEMP%/datacore-c241-vbcompile/Compile.vbproj`; команда `dotnet build <проект> --nologo -v:q`. SDK 8.0.427; TargetFramework net8.0-windows, UseWindowsForms true, OptionExplicit On, OptionStrict Off, OptionInfer On, RootNamespace пустой. Единственная дополнительная ссылка — установленный Autodesk.Inventor.Interop.dll; NuGet-зависимостей нет.

Обёртка Rule.vb механически удаляет строки iLogic `AddReference`, добавляет `Imports System.Windows.Forms` и свойство `Public Property ThisApplication As Inventor.Application` сразу после `Class ThisRule`. Остальной исходник, включая новые выбор/context/retry и прежнюю геометрию, используется целиком без изменений.

Это проверка синтаксиса/типов против установленного Autodesk interop, **не** выполнение внешнего правила в iLogic. Настройки компилятора/host Inventor, реальное отображение диалога, геометрия, экспорт, HTTP и PDF проверяются отдельным пользовательским сценарием. Статический Node-тест также не заменяет такой запуск.
