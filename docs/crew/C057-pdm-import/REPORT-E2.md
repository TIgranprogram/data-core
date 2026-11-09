# REPORT C057-Э2 — приложение «Загрузка из PDM»

**Статус:** Э2 + Э2б + **Э2в** (переменные из «@», лист/фанера в «Что купить») готовы. Картинки на сайт — клиент готов, стенд ещё 404.

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
| Окно (сайт, вход, дерево, план, расхождения, пакет, кнопки сайта) | ✅ |
| `publish.ps1` → `out/<версия>/DataCore.PdmLoader.exe` + `meta.json` | ✅ |
| `samples/6104.pdm-tree.json` | ✅ |
| Э2б: preview/apply/files на стенде, JWT refresh | ✅ |
| Э2б: превью PNG (оболочка / первая стр. PDF) в пакет `previews/` | ✅ |

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

## Э2б — стенд `http://localhost:3001` (2026-11-09)

Команда: `dotnet run -c Release -- stand-6104 --url http://localhost:3001 --json samples/6104.pdm-tree.json`

| Шаг | Итог |
|--|--|
| Вход admin (сид `.env`) | ✅ |
| Первая загрузка | **created=126**, linked=0, updated=0, skipped=0 |
| Повторная загрузка | **created=0**, linked=126, skipped=126 |
| `needFiles` + upload DXF `0000.0000.0019` | ✅ 1 файл |
| `GET …/purchase-needs?qty=1` | ✅ → `samples/6104.purchase-needs.json` |
| `GET /api/pdm-files?ownerKind=material&ownerId=<0019>` | ✅ DXF v1 current → `samples/6104.0019.pdm-files.json` |
| `publish.ps1` | ✅ `out/1.1.0/DataCore.PdmLoader.exe` + `meta.json` (sha256 в meta) |

### Ошибки / замечания сервера (не чинил)

1. **`purchase-needs` не считает лист/фанеру** — в ответе только метизы и покупные; детали листа в `missingBlank` (в т.ч. `0000.0000.0019`), хотя в дереве PDM у 0019 был `blank` 253,1×80.  
   - Запрос: `GET /api/products/<id>/purchase-needs?qty=1`  
   - Ожидание: позиции сырья «лист 4 мм», фанера.  
   - Факт: `items` = fasteners/purchased; сырьё отсутствует.  
2. **Поиск `GET /api/materials?search=0000.0000.0019`** → `total:0` (деталь есть, id из `missingBlank`). Фильтр `?article=` игнорирует точное значение и отдаёт чужие записи.  
3. **Фото на сайт** из `previews/` — сервер ещё не принимает; картинка только в zip-пакете. Нужен эндпоинт/поле фото позиции (отдельная задача сервера).

## Э2в — переменные «конфиг → @» и повтор 6104 (2026-11-09)

| Пункт | Итог |
|--|--|
| `Variables.Read`: сначала конфиг родителя, пусто → `@` | ✅ |
| `dump-vars 0000.0000.0019` | `@`: Сортамент «Лист, 4 мм…», Материал «Ст 3…», Масса 0.532, Вид_изделия «Деталь»; `00 Стандартная`: Длина 109 |
| `export-6104 --no-files` | у **85/85** деталей заполнены `vars.Сортамент` / `Материал` / `massKg`; 0019 blank thickness=4 (из сортамента) |
| Вид из папки PDM | только если `Вид_изделия` пуст и в `@` — warning `kind-from-folder` |
| Повтор на стенде `stand-6104` | preview: create=26, link=59, **conflict=12**, same=29 → apply `update-all`; apply#2 created=0 |
| `purchase-needs?qty=1` | **raw=14** (Лист 2/4 мм, лист нерж., фанера 15/21/27 мм, трубы, брус) + fastener=19 + purchased=6; **missingBlank=0** → `samples/6104.purchase-needs.json` |
| `POST /pdm-import/preview-image` | клиент `UploadPreviewImageAsync` + вызов после apply (окно и stand-6104); на стенде сейчас **404** — жду выкладки сервера координатора |
| Версия приложения | **1.1.1** |

Замечание Э2б п.1 («нет листа/фанеры») — **снято**: причина была в приложении (не читали `@`), не в сервере. П.2 поиска деталей — не ошибка (`?withParts=1`). П.3 картинок — эндпоинт в CONTRACT есть, в docker-стенде ещё нет.

## Риски / допущения

- Числа из GetVar нормализуются с точкой; «0» → null.
- Превью: Shell thumbnail, иначе Windows.Data.Pdf; без SolidWorks.
- Локальный стенд; прод не трогали.
