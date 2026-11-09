# C057 — договор «Приложение PDM ↔ сервер» (pdm-tree/1)

> Единственный источник формата. Меняет только координатор; обе стороны (сервер — Э1, приложение — Э2) сверяются с ним. Пример на 6104 — `samples/6104.pdm-tree.json` (кладёт Э2 после первого прогона).

## 1. Вход

`POST /api/auth/login` `{ "username": "...", "password": "..." }` → `{ accessToken, ... }` (refresh — cookie / `POST /api/auth/refresh`). Все запросы ниже — `Authorization: Bearer <accessToken>`. Права: роль `admin` (сервер проверяет сам). Лимит входа: 5 в минуту — приложение не повторяет вход в цикле.

## 2. Дерево изделия — `pdm-tree/1` (JSON, UTF-8)

```jsonc
{
  "schema": "pdm-tree/1",
  "vault": "PDM",
  "readAt": "2026-11-09T18:00:00Z",
  "reader": { "app": "DataCore PDM Loader", "version": "1.0.0", "computer": "PC-ENG4", "user": "engineer4" },
  "root": "6104.0000.0000",
  "items": [                      // каждая ERP-позиция ОДИН раз (уникальна по designation)
    {
      "designation": "0000.0000.0019",   // из ИМЕНИ ФАЙЛА без расширения и без «^…»; одно написание (латиница → как в файле)
      "kind": "part",                    // product | module | part | fastener | purchased
      "pdmKind": "Деталь",               // как в переменной Вид_изделия
      "aliases": ["…"],                  // другие написания: Number, кириллица; может быть пусто
      "config": "00 Стандартная",        // конфигурация, которую использует родитель (СС-конфигурации — никогда)
      "file": { "id": 3542, "path": "C:\\PDM\\2 Детали\\0_Металл\\0000.0000.0019.SLDPRT",
                "version": 3, "state": "Утверждено", "modified": "2026-07-15T10:00:00Z" },
      "vars": {                          // как в карточке PDM, строки как есть (числа — с точкой)
        "Сортамент": "Лист, 4 мм, ГОСТ 19903-2015", "Материал": "Ст 3 ГОСТ 380-2005",
        "Длина": "109", "Ширина": "80", "Толщина": "79", "Длина_заготовки": null,
        "Масса": "0.27", "Number": null, "RAL": "8017"
      },
      "size":  { "length": 109, "width": 80, "thickness": 79 },            // мм, габарит готового; null — нет
      "blank": { "length": 253.1, "width": 80, "thickness": 4, "source": "dxf" }, // только part; source: dxf | pdm | null
      "massKg": 0.27,
      "ral": ["8017"],
      "folder": "61 Детские игровые комплексы",   // только product: папка PDM над папкой изделия
      "preview": "previews/0000.0000.0019.png",   // путь в пакете или null
      "docs": [                                    // только product | module | part (правило 12)
        { "type": "dxf", "name": "0000.0000.0019.DXF", "pdmFileId": 4100, "version": 2,
          "state": "Утверждено", "modified": "…", "sha256": "…", "size": 18342, "file": "files/0000.0000.0019/v2/0000.0000.0019.DXF" }
      ]
    }
  ],
  "bom": [                        // связи ERP-уровня: «Продвинуть» уже растворено, количества сложены
    { "parent": "6104.0000.0000", "child": "0000.1005.0000", "qty": 24 },
    { "parent": "0000.1005.0000", "child": "0000.1005.0001", "qty": 1 }
  ],
  "warnings": [ { "designation": "BM08.110.D603", "code": "number-mismatch", "text": "Number БМ08.095.D603 не совпадает с именем файла" } ]
}
```

**Правила дерева (проверяет приложение, перепроверяет сервер):**
- В `items` нет: сборок с «Продвинуть» (сборочные модули, соединения), СС-конфигураций, файлов без `Вид_изделия` ERP-вида.
- `bom.qty` — количество на одного родителя, как в спецификации SolidWorks. Одинаковые дети одного родителя сложены в одну строку.
- `docs.type`: `pdf` (чертёж детали/модуля), `dxf` (развёртка), `assembly` (сборочный чертёж изделия `_SS`), `install` (схема установки `_BSUP`). Только PDF и DXF. Не берём: xlsx, SLDPRT/SLDASM/SLDDRW, STEP.
- Метизы и покупные: `docs` всегда пустой.
- `warnings.code` (известные серверу): `number-mismatch` (Number ≠ имя файла), `config-conflict` (одно обозначение, родители ссылаются на разные конфигурации с разными размерами — сервер блокирует эту позицию до решения человека), `no-blank` (деталь без размера заготовки), `no-bom` (Computed BOM не прочитан).

## 3. Обмен с сервером

| Шаг | Запрос | Ответ |
|--|--|--|
| Предпросмотр | `POST /api/pdm-import/preview` — тело: `pdm-tree/1` (без файлов) | план: по каждому `designation` → `create` / `link` (`targetId`, `by: pdmCode\|alias\|matchKey`) / `suggest` (кандидаты) / `conflict` (поля «сайт \| PDM») / `same`; плюс `needFiles: [sha256]` — каких файлов нет на сервере; `blockers[]` (что не даст загрузить) |
| Загрузка | `POST /api/pdm-import/apply` — `{ tree, decisions: { "<designation>": { "action": "create\|link\|update-all\|keep-site", "targetId"?: "...", "fields"?: { "<поле>": "site\|pdm" } } } }` | `{ importId, created, linked, updated, skipped, needFiles: [sha256] }` — повторный вызов с тем же деревом ничего не дублирует |
| Файлы | `POST /api/pdm-import/files` — multipart: `file` + поля `importId, designation, type, name, pdmFileId, version, state, modified, sha256` | `{ id, stored: true\|false (уже был) }`. Сервер проверяет sha256 и сигнатуру PDF/DXF, ≤ 50 МБ |
| Версия приложения | `GET /api/apps/pdm-loader` | `{ version, size, sha256, uploadedAt }` |
| Скачать | `GET /api/apps/pdm-loader/download` | файл `.exe` (`attachment`) |

Ошибки — обычный формат сервера (`statusCode`, `message` на русском). 401 → приложение просит войти заново. 403 → «Нужны права администратора».
