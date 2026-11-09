# DataCore · Загрузка из PDM

Настольное приложение администратора: читает изделие из SOLIDWORKS PDM (только чтение) и загружает пакет `pdm-tree/1` на сайт.

## Что нужно на ПК

- Windows x64
- Клиент **SOLIDWORKS PDM** (хранилище «PDM»), вход Windows
- SolidWorks **не нужен**

## Сборка

```powershell
cd apps\pdm-loader
.\publish.ps1
```

Готовый файл: `out\<версия>\DataCore.PdmLoader.exe` + `meta.json` (`version`, `size`, `sha256`, `uploadedAt`) — формат для `GET /api/apps/pdm-loader`.

## Команды без окна

```bat
DataCore.PdmLoader.exe list-vaults
DataCore.PdmLoader.exe check-6104
DataCore.PdmLoader.exe export-6104 --out ..\..\docs\crew\C057-pdm-import\samples\6104.pdm-tree.json --no-files
DataCore.PdmLoader.exe stand-6104 --url http://localhost:3001 --json ..\..\docs\crew\C057-pdm-import\samples\6104.pdm-tree.json
```

`check-6104` — сверка с эталоном `*_BSUP_SD.xlsx` (**110 из 110**).  
`stand-6104` — preview → apply → files → повтор → purchase-needs на локальном стенде (не прод).

## Окно

1. Адрес сайта (по умолчанию `http://localhost:3001`) и вход администратора  
2. Номер изделия → «Найти в PDM»  
3. «Проверить на сайте» — план: новое / уже есть / похоже / расхождение / без изменений  
4. Двойной щелчок по строке плана — выбор кандидата или полей «сайт | PDM»; «Обновить всё из PDM»  
5. «Загрузить на сайт» — apply + файлы по `needFiles` (JWT обновляется через refresh)  
6. «Сохранить пакет на диск» — zip: `tree.json` + `files/` + `previews/`

Журналы: `%LOCALAPPDATA%\DataCore\PdmLoader\logs\`  
Кэш: `%LOCALAPPDATA%\DataCore\PdmLoader\cache\`
