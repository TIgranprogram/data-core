# DataCore · Загрузка из PDM

Настольное приложение администратора: читает изделие из SOLIDWORKS PDM (только чтение) и готовит пакет `pdm-tree/1` для сайта.

## Что нужно на ПК

- Windows x64
- Клиент **SOLIDWORKS PDM** (хранилище «PDM»), вход Windows
- SolidWorks **не нужен**

## Сборка

```bat
cd apps\pdm-loader
dotnet publish -c Release
```

Готовый файл: `out\DataCore.PdmLoader.exe` (один файл, .NET внутри).

## Команды без окна

```bat
DataCore.PdmLoader.exe list-vaults
DataCore.PdmLoader.exe check-6104
DataCore.PdmLoader.exe export-6104 --out ..\..\docs\crew\C057-pdm-import\samples\6104.pdm-tree.json --no-files
```

`check-6104` сравнивает развёрнутые количества с эталоном `6104.0000.0000_BSUP_SD.xlsx` из PDM. Готово = **110 из 110**.

## Окно

1. При необходимости — адрес сайта и вход  
2. Номер изделия → «Найти в PDM»  
3. «Сохранить пакет на диск»  
4. «Проверить / Загрузить на сайт» — когда сервер Э1 готов  

Журналы: `%LOCALAPPDATA%\DataCore\PdmLoader\logs\`  
Кэш файлов: `%LOCALAPPDATA%\DataCore\PdmLoader\cache\`
