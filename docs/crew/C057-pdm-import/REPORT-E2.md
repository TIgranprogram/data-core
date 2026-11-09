# REPORT C057-Э2 — приложение «Загрузка из PDM»

**Статус:** приёмка по эталону 6104 выполнена (110/110). UI и пакет готовы; сайт (Э1 preview/apply) — по готовности сервера.

## Сделано

| Пункт | Итог |
|--|--|
| Проект `apps/pdm-loader/` (.NET 8 WinForms, x64, single-file) | ✅ |
| Вход PDM `LoginAuto`, поиск сборки | ✅ |
| Computed BOM → CSV, «Продвинуть» (SMI/SM/S.D*) | ✅ |
| Слияние AsBuilt + полный BOM для подсборки `0000.5001.0000` | ✅ |
| Сверка с `6104.0000.0000_BSUP_SD.xlsx` | ✅ **110 из 110** |
| Алиасы Number + латиница/кириллица (СП05↔SP05) | ✅ |
| Переменные карточки (GetVar); запасной вид по папке PDM | ✅ / ⚠ |
| Развёртка DXF (`0000.0000.0019` = 253,1×80, source=dxf) | ✅ |
| Документы PDF/DXF через GetFileCopy в кэш приложения | ✅ |
| Окно (сайт, вход, дерево, пакет, кнопки сайта) | ✅ |
| `dotnet publish` → `apps/pdm-loader/out/DataCore.PdmLoader.exe` | ✅ |
| `samples/6104.pdm-tree.json` | ✅ |

## Файлы

- `apps/pdm-loader/` — весь код приложения
- `docs/crew/C057-pdm-import/samples/6104.pdm-tree.json`
- `docs/crew/C057-pdm-import/REPORT-E2.md`

## Проверки

```
dotnet build -c Release
dotnet run -c Release -- check-6104 --etalon <кэш>\6104.0000.0000_BSUP_SD.xlsx
→ Совпадение: 110 из 110. Нет: 0. Кол-во: 0. Лишние: 0. (код 0)

dotnet run -c Release -- dump-blank --des 0000.0000.0019
→ blank=253,1 x 80

dotnet publish -c Release
→ out/DataCore.PdmLoader.exe (~165 МБ, self-contained)
```

В `items` нет `SMI.6104.0001`, `SM.2001`, `S.BM08.D603.01`. СС-конфигурации отброшены.

## Как читаются количества

1. Макет «Спецификации», **AsBuilt** — совпадает с эталоном по модулям (`0000.1001.0000`×52 и т.п.).
2. Тот же макет **без AsBuilt** — полные дети `0000.5001.0000` (0010–0012; qty 0004–0006 = 1).
3. Дети `0000.5001.0000` из полного BOM подставляются в AsBuilt-дерево.
4. Сверка листа: колонка «К-во» эталона; сопоставление через `aliases`/`Number` и свёртку СП↔SP.

## Риски / допущения

- Переменные `Вид_изделия` / `Сортамент` / `Материал` через GetVar на этой машине часто пусты; вид берётся из папки PDM (`4 Метизы`→метиз и т.д.). Числа Д/Ш/Т и Number читаются.
- Толщина листа в `blank` при пустом сортаменте может быть `null` (не берём габарит 3D).
- Картинки-превью (thumbnail/PDF) в этой итерации не доведены — в REPORT как недоделанное для следующей доводки.
- Запись на сайт: `POST /api/pdm-import/preview|apply` — пока «Сайт ещё не принимает», ждать Э1.

## Нужно от сервера (Э1)

- `POST /api/pdm-import/preview` и `apply` (+ files) по `CONTRACT.md`
- `GET /api/apps/pdm-loader` (версия) и раздача `DataCore.PdmLoader.exe`
